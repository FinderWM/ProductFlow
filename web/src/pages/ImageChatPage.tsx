import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "vaul";
import {
  ChevronRight,
  Download,
  GalleryHorizontalEnd,
  History,
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
import { useNavigate, useParams } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { GalleryImagePreviewDialog } from "../components/GalleryImagePreviewDialog";
import { ImageGenerationSettingsPanel } from "../components/ImageGenerationSettingsPanel";
import { ImageGenerationSettingsTabs, type ImageGenerationSettingsTab } from "../components/ImageGenerationSettingsTabs";
import { ImageToolControls } from "../components/ImageToolControls";
import { ParameterHelpLabel } from "../components/ParameterHelp";
import { PromptPreviewDialog, type PromptPreview } from "../components/PromptPreviewDialog";
import {
  getResourceBlockedActionTitle,
  isResourceBlocked,
  ResourceBlockedNotice,
  ResourceMetaBadges,
} from "../components/ResourceGovernance";
import { SelectField } from "../components/SelectField";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS } from "../lib/imageToolOptions";
import { useI18n } from "../lib/preferences";
import {
  API_GALLERY_WRITE,
  API_IMAGE_CHAT_GENERATE,
  API_IMAGE_CHAT_WRITE,
  API_INSPIRATIONS_WRITE,
  hasSessionApiPermission,
} from "../lib/rbac";
import { useSessionState } from "../lib/session";
import { DEFAULT_IMAGE_GENERATION_MAX_DIMENSION, buildImageSizeOptions } from "../lib/imageSizes";
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
  clampGenerationCount,
  clampImageGenerationTaskCandidateCount,
  compactImageToolOptions,
  effectiveImageGenerationSubmitCount,
  findImageHistoryPlaceholder,
  imageGenerationTaskSubmitPayload,
  isImageSessionGenerationTaskActive,
  isImageSessionGenerationTaskCancelable,
  isImageSessionGenerationTaskRegeneratable,
  isImageSessionGenerationTaskRetryable,
  mergeImageSessionStatusIntoDetail,
  pruneSelectedReferenceIds,
  reconcileImageSessionSelection,
  requiresImageSessionGenerationBase,
  selectImageGenerationTaskNextPlaceholderId,
  selectSubmittedImageGenerationTaskPlaceholderId,
  shouldBlockDuplicateGenerationSubmit,
  shouldRefreshImageSessionDetailFromStatus,
} from "./image-chat/branching";
import type {
  ImageGenerationSubmitGuard,
  ImageGenerationSubmitPayload,
} from "./image-chat/branching";
import type {
  ImageSessionDetail,
  ImageSessionAsset,
  ImageSessionRound,
  ImageSessionGenerationTask,
  ImageSessionListResponse,
  ImageSessionStatus,
  ImageToolOptions,
  GenerationResourceGroup,
  ModerationFields,
  SourceAsset,
} from "../lib/types";

const DUPLICATE_GENERATION_SUBMIT_WINDOW_MS = 1800;
const MAX_BRANCH_CONTEXT_IMAGES = 6;
const DESKTOP_RESIZABLE_LAYOUT_QUERY = "(min-width: 1024px)";
const INSPIRATION_PICKER_LIST_STALE_TIME_MS = 60_000;
const RUNTIME_CONFIG_STALE_TIME_MS = 5 * 60_000;
const RBAC_USERS_STALE_TIME_MS = 5 * 60_000;
const IMAGE_CHAT_GENERATION_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type ImageChatResizeTarget = "left" | "right" | "history";

interface ImageChatRouteState {
  selectedSessionId: string | null;
  selectedGeneratedAssetId: string | null;
  selectedTaskPlaceholderId: string | null;
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
    selectedReferenceAssetIds: [...cached.selectedReferenceAssetIds],
    toolOptions: { ...cached.toolOptions },
  };
}

function writeImageChatRouteState(scope: string, state: ImageChatRouteState) {
  imageChatRouteStateCache.set(scope, {
    ...state,
    selectedReferenceAssetIds: [...state.selectedReferenceAssetIds],
    toolOptions: { ...state.toolOptions },
  });
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

export function ImageChatPage() {
  const { t } = useI18n();
  const sessionState = useSessionState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { inspirationId } = useParams();
  const isInspirationMode = Boolean(inspirationId);
  const routeStateScope = getImageChatRouteStateScope(inspirationId);
  const autoCreateTriggered = useRef(false);
  const pendingGeneratedRoundCountRef = useRef<number | null>(null);
  const duplicateSubmitGuardRef = useRef<ImageGenerationSubmitGuard | null>(null);
  const mobileSessionButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileHistoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const createSessionDialogTitleId = useId();
  const createSessionDialogDescriptionId = useId();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => readImageChatRouteState(routeStateScope)?.selectedSessionId ?? null,
  );
  const [selectedGeneratedAssetId, setSelectedGeneratedAssetId] = useState<string | null>(
    () => readImageChatRouteState(routeStateScope)?.selectedGeneratedAssetId ?? null,
  );
  const [selectedTaskPlaceholderId, setSelectedTaskPlaceholderId] = useState<string | null>(
    () => readImageChatRouteState(routeStateScope)?.selectedTaskPlaceholderId ?? null,
  );
  const [branchBaseAssetId, setBranchBaseAssetId] = useState<string | null>(
    () => readImageChatRouteState(routeStateScope)?.branchBaseAssetId ?? null,
  );
  const [selectedReferenceAssetIds, setSelectedReferenceAssetIds] = useState<string[]>(
    () => readImageChatRouteState(routeStateScope)?.selectedReferenceAssetIds ?? [],
  );
  const [generationCount, setGenerationCount] = useState(
    () => readImageChatRouteState(routeStateScope)?.generationCount ?? 1,
  );
  const [draft, setDraft] = useState(() => readImageChatRouteState(routeStateScope)?.draft ?? "");
  const [size, setSize] = useState(() => readImageChatRouteState(routeStateScope)?.size ?? "1024x1024");
  const [toolOptions, setToolOptions] = useState<ImageToolOptions>(
    () => readImageChatRouteState(routeStateScope)?.toolOptions ?? {},
  );
  const [settingsTab, setSettingsTab] = useState<ImageGenerationSettingsTab>(
    () => readImageChatRouteState(routeStateScope)?.settingsTab ?? "basic",
  );
  const [selectedResourceGroupId, setSelectedResourceGroupId] = useState<string | null>(
    () => readImageChatRouteState(routeStateScope)?.selectedResourceGroupId ?? null,
  );
  const [selectedSessionResourceGroupId, setSelectedSessionResourceGroupId] = useState<string | null>(
    () => readImageChatRouteState(routeStateScope)?.selectedSessionResourceGroupId ?? null,
  );
  const [selectedSessionOwnerUserId, setSelectedSessionOwnerUserId] = useState(
    () => readImageChatRouteState(routeStateScope)?.selectedSessionOwnerUserId ?? "",
  );
  const [onlyDeletedSessions, setOnlyDeletedSessions] = useState(
    () => readImageChatRouteState(routeStateScope)?.onlyDeletedSessions ?? false,
  );
  const [createSessionDialogOpen, setCreateSessionDialogOpen] = useState(false);
  const [createSessionResourceGroupId, setCreateSessionResourceGroupId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [renameEnabled, setRenameEnabled] = useState(false);
  const [targetInspirationId, setTargetInspirationId] = useState(
    () => readImageChatRouteState(routeStateScope)?.targetInspirationId ?? "",
  );
  const [promptPreview, setPromptPreview] = useState<PromptPreview | null>(null);
  const [polishedPrompt, setPolishedPrompt] = useState("");
  const [previewRound, setPreviewRound] = useState<ImageSessionRound | null>(null);
  const [referencePreview, setReferencePreview] = useState<ReferenceImagePreview | null>(null);
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

  const leftPanelStyle = {
    "--image-chat-left-panel-width": `${leftPanelWidth}px`,
  } as CSSProperties;
  const rightPanelStyle = {
    "--image-chat-right-panel-width": `${rightPanelWidth}px`,
  } as CSSProperties;
  const historyPanelStyle = {
    "--image-chat-history-panel-height": `${historyPanelHeight}px`,
  } as CSSProperties;

  useEffect(() => {
    writeImageChatRouteState(routeStateScope, {
      selectedSessionId,
      selectedGeneratedAssetId,
      selectedTaskPlaceholderId,
      branchBaseAssetId,
      selectedReferenceAssetIds,
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
    branchBaseAssetId,
    draft,
    generationCount,
    routeStateScope,
    selectedGeneratedAssetId,
    selectedResourceGroupId,
    selectedSessionOwnerUserId,
    selectedSessionResourceGroupId,
    selectedReferenceAssetIds,
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

  const currentUser = sessionState?.user ?? null;
  const isAdmin = Boolean(currentUser?.is_admin);
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
    enabled: selectedSessionResourceGroupId !== null,
  });

  const sessionItems = sessionsQuery.data?.items ?? [];

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
  const rbacUsersQuery = useQuery({
    queryKey: ["rbac-users"],
    queryFn: () => api.listRbacUsers({ page_size: 100 }),
    enabled: isAdmin,
    retry: false,
    staleTime: RBAC_USERS_STALE_TIME_MS,
  });

  const inspirations = inspirationsQuery.data?.items ?? [];
  const rbacUsers = rbacUsersQuery.data?.items ?? [];
  const imageGenerationMaxDimension =
    runtimeConfigQuery.data?.image_generation_max_dimension ?? DEFAULT_IMAGE_GENERATION_MAX_DIMENSION;
  const imageToolAllowedFields = runtimeConfigQuery.data?.image_tool_allowed_fields ?? DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS;
  const deletionEnabled = runtimeConfigQuery.data?.deletion_enabled ?? false;
  const sizeOptions = useMemo(
    () => buildImageSizeOptions(imageGenerationMaxDimension),
    [imageGenerationMaxDimension],
  );
  const resourceGroups = useMemo(
    () => generationResourceGroupsQuery.data?.filter((group) => group.enabled && !group.archived_at) ?? [],
    [generationResourceGroupsQuery.data],
  );
  const currentInspiration = isInspirationMode
    ? (inspirationQuery.data ?? null)
    : (inspirations.find((inspiration) => inspiration.id === targetInspirationId) ?? null);
  const currentInspirationBlocked = isResourceBlocked(currentInspiration);
  const currentInspirationAdminReadonly = isAdminReadonlyResource(currentUser, currentInspiration);
  const adminReadonlyActionTitle = t("resource.adminReadonlyAction");
  const canWriteImageChat = hasSessionApiPermission(sessionState, API_IMAGE_CHAT_WRITE);
  const canGenerateImageChat = hasSessionApiPermission(sessionState, API_IMAGE_CHAT_GENERATE);
  const canWriteGallery = hasSessionApiPermission(sessionState, API_GALLERY_WRITE);
  const canWriteInspirations = hasSessionApiPermission(sessionState, API_INSPIRATIONS_WRITE);
  const imageChatWritePermissionTitle = canWriteImageChat ? null : t("chat.permission.imageChatWriteRequired");
  const imageChatGeneratePermissionTitle = canGenerateImageChat ? null : t("chat.permission.imageChatGenerateRequired");
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
      setSelectedResourceGroupId(resourceGroups[0].id);
    }
    if (
      selectedSessionResourceGroupId === null ||
      (selectedSessionResourceGroupId && !resourceGroups.some((group) => group.id === selectedSessionResourceGroupId))
    ) {
      setSelectedSessionResourceGroupId(resourceGroups[0].id);
    }
  }, [
    generationResourceGroupsQuery.isFetched,
    resourceGroups,
    selectedResourceGroupId,
    selectedSessionResourceGroupId,
  ]);

  function resetImageSessionSelection() {
    setSelectedGeneratedAssetId(null);
    setSelectedTaskPlaceholderId(null);
    setBranchBaseAssetId(null);
    setSelectedReferenceAssetIds([]);
  }

  function handleSelectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    resetImageSessionSelection();
    setSuccessMessage("");
    setErrorMessage("");
    setMobileSessionDrawerOpen(false);
  }

  useEffect(() => {
    if (!isInspirationMode && inspirations.length && !targetInspirationId) {
      setTargetInspirationId(inspirations[0].id);
    }
  }, [isInspirationMode, inspirations, targetInspirationId]);

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
    return resourceGroups[0]?.id ?? "";
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
    if (
      sessionsQuery.isLoading ||
      createSessionMutation.isPending ||
      createSessionDialogOpen ||
      generationResourceGroupsQuery.isLoading
    ) {
      return;
    }
    if (sessionItems.length === 0 && !autoCreateTriggered.current) {
      autoCreateTriggered.current = true;
      if (createSessionBlockedTitle) {
        setErrorMessage(createSessionBlockedTitle);
        return;
      }
      openCreateSessionDialog();
      return;
    }
    if (selectedSessionId && sessionItems.some((item) => item.id === selectedSessionId)) {
      return;
    }
    if (sessionItems.length) {
      setSelectedSessionId(sessionItems[0].id);
      resetImageSessionSelection();
    }
  }, [
    createSessionMutation,
    createSessionDialogOpen,
    createSessionBlockedTitle,
    generationResourceGroupsQuery.isLoading,
    isInspirationMode,
    openCreateSessionDialog,
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
  const historyBranches = useMemo(
    () => buildImageSessionHistoryTree(imageSession?.rounds ?? [], imageSession?.generation_tasks ?? []),
    [imageSession],
  );
  const requiresGenerationBase = requiresImageSessionGenerationBase(
    imageSession?.rounds ?? [],
    imageSession?.generation_tasks ?? [],
  );
  const sessionReferenceAssets = useMemo(() => getSessionReferenceAssets(imageSession), [imageSession]);
  const maxSelectedReferenceCount = branchBaseAssetId ? MAX_BRANCH_CONTEXT_IMAGES - 1 : MAX_BRANCH_CONTEXT_IMAGES;
  const compactedToolOptions = useMemo(
    () => compactImageToolOptions(toolOptions, imageToolAllowedFields),
    [imageToolAllowedFields, toolOptions],
  );
  const submitGenerationCount = effectiveImageGenerationSubmitCount(generationCount, compactedToolOptions);
  const hasActiveGenerationTask = imageSession?.generation_tasks.some(isImageSessionGenerationTaskActive) ?? false;

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
      branchBaseAssetId,
      selectedReferenceAssetIds,
      availableReferenceAssetIds: sessionReferenceAssets.map((asset) => asset.id),
      maxSelectedReferenceCount,
      pendingGeneratedRoundCount: pendingGeneratedRoundCountRef.current,
    });

    if (reconciled.selectedGeneratedAssetId !== selectedGeneratedAssetId) {
      setSelectedGeneratedAssetId(reconciled.selectedGeneratedAssetId);
    }
    if (reconciled.selectedTaskPlaceholderId !== selectedTaskPlaceholderId) {
      setSelectedTaskPlaceholderId(reconciled.selectedTaskPlaceholderId);
    }
    if (reconciled.branchBaseAssetId !== branchBaseAssetId) {
      setBranchBaseAssetId(reconciled.branchBaseAssetId);
    }
    if (reconciled.selectedReferenceAssetIds !== selectedReferenceAssetIds) {
      setSelectedReferenceAssetIds(reconciled.selectedReferenceAssetIds);
    }
    pendingGeneratedRoundCountRef.current = reconciled.pendingGeneratedRoundCount;

    if (reconciled.generatedRoundCompleted) {
      setSuccessMessage(t("chat.newCandidate"));
      setErrorMessage("");
    }
  }, [
    branchBaseAssetId,
    historyBranches,
    imageSession,
    maxSelectedReferenceCount,
    selectedReferenceAssetIds,
    selectedGeneratedAssetId,
    sessionReferenceAssets,
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

  const selectedPlaceholder = useMemo(
    () => findImageHistoryPlaceholder(historyBranches, selectedTaskPlaceholderId),
    [historyBranches, selectedTaskPlaceholderId],
  );
  const activePreviewRound =
    previewRound && imageSession?.rounds.some((round) => round.id === previewRound.id) ? previewRound : null;

  const branchBaseRound = useMemo(() => {
    if (!imageSession?.rounds.length || !branchBaseAssetId) {
      return null;
    }
    return imageSession.rounds.find((round) => round.generated_asset.id === branchBaseAssetId) ?? null;
  }, [branchBaseAssetId, imageSession]);
  const baseRequirementMessage =
    requiresGenerationBase && !branchBaseRound ? t("chat.baseRequired") : "";
  const resourceGroupRequirementMessage = !selectedResourceGroupId ? t("chat.resourceGroupRequired") : "";

  const sourceImage = useMemo(
    () => inspirationQuery.data?.source_assets.find((asset) => asset.kind === "original_image") ?? null,
    [inspirationQuery.data],
  );

  const inspirationReferenceImages = useMemo(
    () => inspirationQuery.data?.source_assets.filter((asset) => asset.kind === "reference_image") ?? [],
    [inspirationQuery.data],
  );
  const selectedReferenceBlockedResource = firstBlockedResource(
    sessionReferenceAssets.filter((asset) => selectedReferenceAssetIds.includes(asset.id)),
  );
  const selectedReferenceAssets = sessionReferenceAssets.filter((asset) => selectedReferenceAssetIds.includes(asset.id));
  const generationBlockedResource = firstBlockedResource([
    imageSession,
    isInspirationMode ? currentInspiration : null,
    requiresGenerationBase ? branchBaseRound?.generated_asset : null,
    selectedReferenceBlockedResource,
  ]);
  const generationAdminReadonly = hasAdminReadonlyResource(currentUser, [
    imageSession,
    isInspirationMode ? currentInspiration : null,
    requiresGenerationBase ? branchBaseRound?.generated_asset : null,
    ...selectedReferenceAssets,
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
        setSelectedReferenceAssetIds((current) =>
          pruneSelectedReferenceIds(
            [...current, ...uploadedReferenceIds],
            getSessionReferenceAssets(updated).map((asset) => asset.id),
            maxSelectedReferenceCount,
          ),
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
        setSelectedReferenceAssetIds((current) =>
          pruneSelectedReferenceIds(
            current,
            getSessionReferenceAssets(updated).map((asset) => asset.id),
            maxSelectedReferenceCount,
          ),
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
        if (!remainingSessions.length) {
          autoCreateTriggered.current = false;
        }
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
        generation_config_mode: "auto",
        generation_config_id: null,
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

  const retryGenerationTaskMutation = useMutation({
    mutationFn: (input: { sessionId: string; taskId: string }) => {
      assertImageChatActionAllowed(generationBlockedTitle);
      return api.retryImageSessionGenerationTask(input.sessionId, input.taskId);
    },
    onSuccess: (updated, input) => {
      queryClient.setQueryData(["image-session", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      const retriedTask = updated.generation_tasks.find((task) => task.id === input.taskId);
      if (retriedTask) {
        setSelectedTaskPlaceholderId(selectImageGenerationTaskNextPlaceholderId(retriedTask));
        setSelectedGeneratedAssetId(null);
      }
      setSuccessMessage(t("chat.retrySubmitted"));
      setErrorMessage("");
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.retryFailed"));
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

  const generateDisabled =
    !selectedSessionId ||
    !imageSession ||
    !draft.trim() ||
    generateMutation.isPending ||
    Boolean(generationBlockedTitle) ||
    Boolean(baseRequirementMessage || resourceGroupRequirementMessage);

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
    mutationFn: (assetId: string) => {
      assertImageChatActionAllowed(selectedResultBlockedTitle);
      return api.saveGalleryEntry(assetId);
    },
    onSuccess: async () => {
      setSuccessMessage(t("chat.savedGallery"));
      setErrorMessage("");
      await queryClient.invalidateQueries({ queryKey: ["gallery"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.saveGalleryFailed"));
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
  const saveSelectedGalleryDisabled = saveGalleryMutation.isPending || Boolean(selectedResultBlockedTitle);
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
    if (baseRequirementMessage) {
      setErrorMessage(baseRequirementMessage);
      return;
    }
    if (resourceGroupRequirementMessage) {
      setErrorMessage(resourceGroupRequirementMessage);
      return;
    }
    const selectedReferenceIds = pruneSelectedReferenceIds(
      selectedReferenceAssetIds,
      sessionReferenceAssets.map((asset) => asset.id),
      maxSelectedReferenceCount,
    );
    const payload: ImageGenerationSubmitPayload = {
      prompt,
      size,
      base_asset_id: requiresGenerationBase ? branchBaseAssetId : null,
      selected_reference_asset_ids: selectedReferenceIds,
      generation_count: clampGenerationCount(generationCount),
      tool_options: compactedToolOptions,
      resource_group_id: selectedResourceGroupId ?? "",
      generation_config_mode: "auto",
      generation_config_id: null,
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

  function handleRetryGenerationTask(task: ImageSessionGenerationTask) {
    if (!selectedSessionId || retryGenerationTaskMutation.isPending || !isImageSessionGenerationTaskRetryable(task)) {
      return;
    }
    if (generationBlockedTitle) {
      setErrorMessage(generationBlockedTitle);
      return;
    }
    pendingGeneratedRoundCountRef.current = imageSession?.rounds.length ?? 0;
    retryGenerationTaskMutation.mutate({ sessionId: selectedSessionId, taskId: task.id });
  }

  function handleCancelGenerationTask(task: ImageSessionGenerationTask) {
    if (
      !selectedSessionId ||
      cancelGenerationTaskMutation.isPending ||
      !isImageSessionGenerationTaskCancelable(task)
    ) {
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
    pendingGeneratedRoundCountRef.current = imageSession.rounds.length;
    const payload = imageGenerationTaskSubmitPayload(task);
    generateMutation.mutate({
      ...payload,
      resource_group_id: payload.resource_group_id || selectedResourceGroupId || "",
    });
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
    if (selectedResultBlockedTitle) {
      setErrorMessage(selectedResultBlockedTitle);
      return;
    }
    saveGalleryMutation.mutate(selectedRound.generated_asset.id);
  }

  function handleSelectHistoryRound(assetId: string) {
    setSelectedGeneratedAssetId(assetId);
    setBranchBaseAssetId(assetId);
    setSelectedTaskPlaceholderId(null);
    setSuccessMessage("");
    setErrorMessage("");
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
    setSelectedReferenceAssetIds((current) => {
      const next = checked ? [...current, assetId] : current.filter((id) => id !== assetId);
      return pruneSelectedReferenceIds(
        next,
        sessionReferenceAssets.map((asset) => asset.id),
        maxSelectedReferenceCount,
      );
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
        <SelectField
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
          onChange={(value) => setSelectedResourceGroupId(value || null)}
          ariaLabel={t("chat.resourceGroup")}
          radius="lg"
          visualSize="sm"
          disabled={disabled}
        />
      </div>
    );
  }

  function renderSessionResourceGroupFilter() {
    return (
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {t("chat.sessionResourceGroupFilter")}
          </span>
          <SelectField
            value={selectedSessionResourceGroupId ?? ""}
            options={[
              { value: "", label: t("chat.allResourceGroups") },
              ...resourceGroups.map((group) => ({
                value: group.id,
                label: resourceGroupOptionLabel(group, t("chat.resourceGroupDisabled")),
                disabled: !group.enabled,
              })),
            ]}
            onChange={setSelectedSessionResourceGroupId}
            ariaLabel={t("chat.sessionResourceGroupFilter")}
            radius="lg"
            visualSize="sm"
            disabled={generationResourceGroupsQuery.isLoading}
          />
        </label>
        {isAdmin ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {t("chat.sessionOwnerFilter")}
              </span>
              <SelectField
                value={selectedSessionOwnerUserId}
                options={[
                  { value: "", label: t("chat.allOwners") },
                  ...rbacUsers.map((user) => ({
                    value: user.id,
                    label: `${user.display_name || user.username} (${user.username})`,
                  })),
                ]}
                onChange={setSelectedSessionOwnerUserId}
                ariaLabel={t("chat.sessionOwnerFilter")}
                radius="lg"
                visualSize="sm"
                disabled={rbacUsersQuery.isLoading}
              />
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              <input
                type="checkbox"
                checked={onlyDeletedSessions}
                onChange={(event) => setOnlyDeletedSessions(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-950 dark:text-violet-400 dark:focus:ring-violet-400"
              />
              <span>{t("chat.onlyDeletedSessions")}</span>
            </label>
          </>
        ) : null}
      </div>
    );
  }

  function renderGenerationSettingsTabs(promptId: string) {
    return (
      <ImageGenerationSettingsTabs
        value={settingsTab}
        onChange={setSettingsTab}
        basic={
          <div className="space-y-4">
            <SessionReferencePanel
              assets={sessionReferenceAssets}
              selectedAssetIds={selectedReferenceAssetIds}
              maxSelectedCount={maxSelectedReferenceCount}
              uploadBusy={uploadReferenceMutation.isPending}
              deletingAssetId={
                deleteSessionReferenceMutation.isPending
                  ? (deleteSessionReferenceMutation.variables?.assetId ?? null)
                  : null
              }
              disabled={!selectedSessionId || Boolean(sessionEditBlockedTitle)}
              selectionDisabled={Boolean(generationSettingsBlockedTitle)}
              onFiles={handleUploadReferenceFiles}
              onToggle={handleReferenceToggle}
              onDelete={handleDeleteSessionReference}
              onPreview={(asset) => setReferencePreview({ asset, title: t("chat.sessionReferences") })}
              t={t}
            />

            {renderResourceGroupSelector({ disabled: Boolean(generationSettingsBlockedTitle) })}

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-950 dark:text-white" htmlFor={promptId}>
                <ParameterHelpLabel label={t("chat.prompt")} helpKey="imageChatPrompt" uiType="imageChat" />
              </label>
              <textarea
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
                className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-3 text-sm leading-6 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-400/20"
              />
              <div className="mt-2 grid gap-2">
                <button
                  type="button"
                  onClick={handlePolishPrompt}
                  disabled={
                    !draft.trim() ||
                    polishPromptMutation.isPending ||
                    Boolean(generationSettingsBlockedTitle || resourceGroupRequirementMessage)
                  }
                  title={generationSettingsBlockedTitle ?? t("chat.polishPrompt")}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-100 disabled:opacity-60 dark:border-violet-400/35 dark:bg-violet-500/15 dark:text-violet-100 dark:hover:border-violet-300/55 dark:hover:bg-violet-500/25"
                >
                  {polishPromptMutation.isPending ? (
                    <Loader2 size={13} className="mr-1.5 animate-spin" />
                  ) : (
                    <Sparkles size={13} className="mr-1.5" />
                  )}
                  {t("chat.polishPrompt")}
                </button>
                {polishedPrompt ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-100">
                    <div className="whitespace-pre-wrap">{polishedPrompt}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={handleUsePolishedPrompt}
                        disabled={Boolean(generationSettingsBlockedTitle)}
                        title={generationSettingsBlockedTitle ?? t("chat.usePolishedPrompt")}
                        className="inline-flex items-center rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
                      >
                        {t("chat.usePolishedPrompt")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPolishedPrompt("")}
                        className="inline-flex items-center rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:border-emerald-300 dark:border-emerald-400/30 dark:bg-slate-950/60 dark:text-emerald-100"
                      >
                        {t("common.cancel")}
                      </button>
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
          />
        }
      />
    );
  }

  function renderGenerationSettingsSection(promptId: string) {
    return (
      <section className="space-y-3">
        <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 dark:text-white">
          <Settings size={15} /> {t("chat.generationSettings")}
        </div>
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
    <div className="pf-workspace flex flex-col text-slate-900 dark:text-slate-100 lg:h-[100dvh] lg:overflow-hidden">
      <TopNav
        breadcrumbs={isInspirationMode ? `${inspirationQuery.data?.name ?? t("chat.inspirationFallback")} / ${t("chat.breadcrumb")}` : t("chat.breadcrumb")}
        onHome={() => navigate(isInspirationMode && inspirationId ? `/inspirations/${inspirationId}` : "/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />

      <main
        className="flex min-h-0 flex-1 flex-col pb-[calc(8.5rem+env(safe-area-inset-bottom))] lg:flex-row lg:overflow-hidden lg:pb-0"
        onPointerDown={handleMobileEdgeSwipeStart}
      >
        <aside
          className="relative hidden w-full shrink-0 flex-col border-b border-slate-200 bg-white/95 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-[12px_0_36px_rgba(0,0,0,0.24)] dark:backdrop-blur-xl lg:flex lg:w-[var(--image-chat-left-panel-width)] lg:border-b-0 lg:border-r"
          style={leftPanelStyle}
        >
          <button
            type="button"
            aria-label={t("chat.resizeSessions")}
            title={t("chat.resizeSessionsTitle")}
            onPointerDown={(event) => handlePanelResizeStart("left", event)}
            className="absolute right-[-5px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center transition-colors hover:bg-indigo-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-violet-500/15 lg:flex"
          >
            <span className="h-12 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
          </button>
          <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950 dark:text-white">{t("chat.sessions")}</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("chat.count", { count: sessionItems.length })}</div>
              </div>
              <button
                type="button"
                onClick={openCreateSessionDialog}
                disabled={createSessionDisabled}
                title={createSessionButtonTitle}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-500/20 transition-colors hover:bg-indigo-500 disabled:opacity-60 dark:bg-gradient-to-br dark:from-indigo-500 dark:to-violet-500 dark:shadow-violet-900/35 dark:ring-1 dark:ring-violet-300/30"
                aria-label={t("chat.newSession")}
              >
                {createSessionMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
              </button>
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
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            t={t}
          />
        </aside>

        <section className="pf-workspace-stage flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col p-3 pb-2">
            <div className="mb-3 flex items-center justify-between gap-1.5 lg:hidden">
              <button
                ref={mobileSessionButtonRef}
                type="button"
                onClick={() => setMobileSessionDrawerOpen(true)}
                aria-label={t("chat.openSessionDrawer")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors active:scale-[0.98] hover:border-indigo-200 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200 dark:hover:border-violet-400/60 dark:hover:text-violet-100"
              >
                <Menu size={18} />
              </button>
              <div className="min-w-0 flex-1 px-1 text-left">
                {renameEnabled ? (
                  <input
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
                    className="h-10 w-full rounded-xl border border-indigo-200 bg-white px-3 text-center text-sm font-semibold text-slate-950 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-500 dark:border-violet-400/45 dark:bg-slate-950/80 dark:text-white dark:focus:border-violet-300 dark:focus:ring-violet-400/20"
                  />
                ) : (
                  <>
                    <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                      {imageSession?.title ?? t("chat.workbench")}
                    </div>
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
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
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:text-violet-100"
                >
                  {renameSessionMutation.isPending ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : renameEnabled ? (
                    <Save size={17} />
                  ) : (
                    <Pencil size={16} />
                  )}
                </button>
                <button
                  ref={mobileHistoryButtonRef}
                  type="button"
                  onClick={() => setMobileHistoryDrawerOpen(true)}
                  aria-label={t("chat.openHistoryDrawer")}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:text-violet-100"
                >
                  <History size={17} />
                </button>
              </div>
            </div>
            <div className="mb-3 hidden flex-col gap-3 lg:flex lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-300">
                  <span className="inline-flex h-7 items-center rounded-full bg-white px-3 shadow-sm ring-1 ring-slate-200 dark:border dark:border-violet-400/30 dark:bg-slate-950/70 dark:text-violet-100 dark:ring-violet-400/20">
                    {t("chat.currentResult")}
                  </span>
                  {branchBaseRound ? (
                    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-indigo-600 px-3 text-white shadow-sm shadow-indigo-500/20 dark:bg-violet-500/20 dark:text-violet-100 dark:ring-1 dark:ring-violet-400/40">
                      <Layers3 size={12} /> {t("chat.baseSelected")}
                    </span>
                  ) : null}
                </div>
                <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-950 dark:text-white">
                  {imageSession?.title ?? t("chat.workbench")}
                </h1>
                <ResourceMetaBadges resource={imageSession} className="mt-1" showReason />
                {selectedRound ? (
                  <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400 md:hidden">
                    {imageRoundSizeLabel(selectedRound, t)} · {t("chat.candidate", { index: selectedRound.candidate_index, count: selectedRound.candidate_count })}
                    <span className="ml-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                      {selectedRound.resource_group.name}
                    </span>
                    <ResourceMetaBadges resource={selectedRound.generated_asset} className="mt-1" showReason />
                  </div>
                ) : selectedPlaceholder ? (
                  <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400 md:hidden">
                    {placeholderStatusLabel(selectedPlaceholder, t)} · {t("chat.candidate", { index: selectedPlaceholder.candidate_index, count: selectedPlaceholder.candidate_count })}
                  </div>
                ) : null}
              </div>
              <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                {selectedRound ? (
                  <>
                    <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200 md:inline-flex">
                      {imageRoundSizeLabel(selectedRound, t)} · {t("chat.candidate", { index: selectedRound.candidate_index, count: selectedRound.candidate_count })}
                    </span>
                    <span className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200 md:inline-flex">
                      {selectedRound.resource_group.name}
                    </span>
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
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:border-indigo-200 hover:text-indigo-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200 dark:hover:border-violet-400/60 dark:hover:text-violet-100"
                      aria-disabled={Boolean(selectedResultResourceBlockedTitle)}
                    >
                      <Download size={15} />
                    </a>
                    <button
                      type="button"
                      onClick={handleSaveSelectedToGallery}
                      disabled={saveSelectedGalleryDisabled}
                      title={selectedResultBlockedTitle ?? t("chat.saveSelectedGallery")}
                      aria-label={t("chat.saveSelectedGallery")}
                      className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 ring-1 ring-indigo-500 transition-colors hover:bg-indigo-700 disabled:opacity-60 dark:bg-gradient-to-r dark:from-indigo-500 dark:to-violet-500 dark:shadow-violet-900/35 dark:ring-violet-300/35"
                    >
                      {saveGalleryMutation.isPending ? (
                        <Loader2 size={16} className="mr-2 animate-spin" />
                      ) : (
                        <GalleryHorizontalEnd size={16} className="mr-2" />
                      )}
                      {t("chat.sendGallery")}
                    </button>
                  </>
                ) : selectedPlaceholder ? (
                  <span className={`rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm ${placeholderStatusClass(selectedPlaceholder)}`}>
                    {placeholderStatusLabel(selectedPlaceholder, t)}
                  </span>
                ) : null}
              </div>
            </div>
            {sessionOrInspirationBlockedResource ? (
              <ResourceBlockedNotice resource={sessionOrInspirationBlockedResource} className="mb-3" />
            ) : null}

            <ImageChatMainStage
              selectedRound={selectedRound}
              selectedPlaceholder={selectedPlaceholder}
              branchBaseRound={branchBaseRound}
              retryingTaskId={retryGenerationTaskMutation.isPending ? (retryGenerationTaskMutation.variables?.taskId ?? null) : null}
              cancellingTaskId={cancelGenerationTaskMutation.isPending ? (cancelGenerationTaskMutation.variables?.taskId ?? null) : null}
              regenerating={generateMutation.isPending}
              generationBlockedTitle={generationBlockedTitle}
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
            {selectedRound?.provider_notes.length ? (
              <div className="mt-2 flex flex-wrap gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200">
                {selectedRound.provider_notes.map((note) => (
                  <span key={note}>{note}</span>
                ))}
              </div>
            ) : selectedPlaceholder?.failure_reason ? (
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
            branchBaseAssetId={branchBaseAssetId}
            branchBaseSelected={Boolean(branchBaseRound)}
            style={historyPanelStyle}
            onResizeStart={(event) => handlePanelResizeStart("history", event)}
            onSelectRound={handleSelectHistoryRound}
            onSelectPlaceholder={handleSelectHistoryPlaceholder}
            onPreviewPrompt={setPromptPreview}
            t={t}
          />
        </section>

        <aside
          className="relative hidden w-full shrink-0 flex-col border-t border-slate-200 bg-white dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-[-12px_0_36px_rgba(0,0,0,0.24)] dark:backdrop-blur-xl lg:flex lg:w-[var(--image-chat-right-panel-width)] lg:border-l lg:border-t-0"
          style={rightPanelStyle}
        >
          <button
            type="button"
            aria-label={t("chat.resizeSettings")}
            title={t("chat.resizeSettingsTitle")}
            onPointerDown={(event) => handlePanelResizeStart("right", event)}
            className="absolute left-[-5px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center transition-colors hover:bg-indigo-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-violet-500/15 lg:flex"
          >
            <span className="h-12 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
          </button>
          <div className="min-h-0 flex-1 space-y-6 px-4 py-5 lg:overflow-y-auto lg:px-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 dark:text-white">
                    <Pencil size={15} /> {t("chat.sessionSettings")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRenameEnabled((current) => !current)}
                  disabled={renameSessionDisabled}
                  title={sessionEditBlockedTitle ?? t("chat.rename")}
                  className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:border-violet-400/50 dark:hover:text-violet-100"
                >
                  <Pencil size={12} className="mr-1.5" /> {t("chat.rename")}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  disabled={!renameEnabled || renameSessionMutation.isPending || Boolean(sessionEditBlockedTitle)}
                  title={sessionEditBlockedTitle ?? t("chat.rename")}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:focus:border-violet-400 dark:focus:ring-violet-400/20 dark:disabled:bg-slate-900 dark:disabled:text-slate-500"
                />
                {renameEnabled ? (
                  <button
                    type="button"
                    onClick={handleRename}
                    disabled={renameSessionMutation.isPending || Boolean(sessionEditBlockedTitle)}
                    title={sessionEditBlockedTitle ?? t("chat.saveSessionName")}
                    className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
                    aria-label={t("chat.saveSessionName")}
                  >
                    {renameSessionMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  </button>
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
            {generationBlockedResource ? (
              <ResourceBlockedNotice resource={generationBlockedResource} className="mb-2" />
            ) : null}
            {baseRequirementMessage || resourceGroupRequirementMessage ? (
              <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200">
                {baseRequirementMessage || resourceGroupRequirementMessage}
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generateDisabled}
              title={generationBlockedTitle ?? t("chat.startGenerate")}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-indigo-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-500 disabled:opacity-60 dark:bg-gradient-to-r dark:from-indigo-500 dark:via-violet-500 dark:to-fuchsia-500 dark:shadow-violet-900/45 dark:ring-1 dark:ring-violet-300/35"
            >
              {generateMutation.isPending ? (
                <Loader2 size={15} className="mr-2 animate-spin" />
              ) : (
                <Sparkles size={15} className="mr-2" />
              )}
              {generateMutation.isPending
                ? t("chat.submitting")
                : submitGenerationCount > 1
                  ? t("chat.startGenerateCount", { count: submitGenerationCount })
                  : t("chat.startGenerate")}
            </button>
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
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[2px] lg:hidden" />
          <Drawer.Content
            onPointerDown={handleMobileSessionDrawerSwipeBackStart}
            className="fixed inset-y-0 left-0 z-[71] flex w-[min(86vw,360px)] flex-col border-r border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-[#0f1726] lg:hidden"
          >
            <Drawer.Title className="sr-only">{t("chat.mobileSessionDrawer")}</Drawer.Title>
            <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">{t("chat.sessions")}</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("chat.count", { count: sessionItems.length })}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openCreateSessionDialog}
                    disabled={createSessionDisabled}
                    title={createSessionButtonTitle}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm shadow-indigo-500/20 transition-colors active:scale-[0.98] hover:bg-indigo-500 disabled:opacity-60 dark:bg-gradient-to-br dark:from-indigo-500 dark:to-violet-500 dark:shadow-violet-900/35 dark:ring-1 dark:ring-violet-300/30"
                    aria-label={t("chat.newSession")}
                  >
                    {createSessionMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
                  </button>
                  <button
                    type="button"
                    aria-label={t("chat.closeSessionDrawer")}
                    onClick={() => {
                      setMobileSessionDrawerOpen(false);
                      mobileSessionButtonRef.current?.focus();
                    }}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-colors active:scale-[0.98] hover:border-slate-300 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:text-violet-100"
                  >
                    <X size={18} />
                  </button>
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
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[2px] lg:hidden" />
          <Drawer.Content className="fixed inset-y-0 right-0 z-[71] flex w-[7.75rem] flex-col border-l border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-[#0f1726] lg:hidden">
            <Drawer.Title className="sr-only">{t("chat.mobileHistoryDrawer")}</Drawer.Title>
            <div className="flex items-center justify-between gap-1 border-b border-slate-200 px-2 py-3 dark:border-slate-800">
              <div className="min-w-0 px-1">
                <div className="text-sm font-semibold text-slate-950 dark:text-white">{t("chat.history")}</div>
              </div>
              <button
                type="button"
                aria-label={t("chat.closeHistoryDrawer")}
                onClick={() => {
                  setMobileHistoryDrawerOpen(false);
                  mobileHistoryButtonRef.current?.focus();
                }}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-colors active:scale-[0.98] hover:border-slate-300 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:text-violet-100"
              >
                <X size={18} />
              </button>
            </div>
            <ImageChatHistoryPanel
              historyBranches={historyBranches}
              selectedGeneratedAssetId={selectedGeneratedAssetId}
              selectedTaskPlaceholderId={selectedTaskPlaceholderId}
              branchBaseAssetId={branchBaseAssetId}
              branchBaseSelected={Boolean(branchBaseRound)}
              variant="mobileDrawer"
              onSelectRound={handleSelectHistoryRound}
              onSelectPlaceholder={handleSelectHistoryPlaceholder}
              onPreviewPrompt={setPromptPreview}
              t={t}
            />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <div className="fixed inset-x-0 z-40 px-3 lg:hidden" style={{ bottom: "calc(4.1rem + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_-6px_18px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-950 dark:shadow-[0_-12px_28px_rgba(0,0,0,0.30)]">
          {selectedRound ? (
            <div className="flex shrink-0 items-center gap-1.5">
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
                aria-disabled={Boolean(selectedResultResourceBlockedTitle)}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors active:scale-[0.98] hover:border-indigo-200 hover:text-indigo-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200 dark:hover:border-violet-400/60 dark:hover:text-violet-100 dark:focus-visible:ring-violet-400"
              >
                <Download size={15} className="shrink-0" />
                <span>{t("chat.downloadShort")}</span>
              </a>
              <button
                type="button"
                onClick={handleSaveSelectedToGallery}
                disabled={saveSelectedGalleryDisabled}
                title={selectedResultBlockedTitle ?? t("chat.saveSelectedGallery")}
                aria-label={t("chat.saveSelectedGallery")}
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-semibold text-indigo-700 shadow-sm transition-colors active:scale-[0.98] hover:border-indigo-300 hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60 dark:border-violet-400/35 dark:bg-violet-500/15 dark:text-violet-100 dark:hover:border-violet-300/55 dark:hover:bg-violet-500/25 dark:focus-visible:ring-violet-400"
              >
                {saveGalleryMutation.isPending ? <Loader2 size={15} className="shrink-0 animate-spin" /> : <GalleryHorizontalEnd size={15} className="shrink-0" />}
                <span>{t("chat.sendGalleryShort")}</span>
              </button>
            </div>
          ) : null}
          <button
            ref={mobileSettingsButtonRef}
            type="button"
            onClick={() => setMobileGenerationSheetOpen(true)}
            className={`flex min-h-11 min-w-0 items-center rounded-xl bg-indigo-600 text-left text-white shadow-md shadow-indigo-600/16 transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-violet-600 dark:shadow-violet-900/35 dark:ring-1 dark:ring-violet-300/35 dark:focus-visible:ring-violet-300 ${
              selectedRound ? "flex-1 px-2.5" : "w-full px-3"
            }`}
            aria-label={t("chat.openGenerationSheet")}
          >
            <Sparkles size={17} className="mr-2 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-5">{t("chat.mobileGenerate")}</span>
            </span>
            <ChevronRight size={17} className="ml-2 shrink-0 text-indigo-100 dark:text-violet-100" />
          </button>
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
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-slate-950/42 lg:hidden" />
          <Drawer.Content className="mobile-generation-sheet fixed inset-x-0 bottom-0 z-[71] flex max-h-[80dvh] flex-col rounded-t-[1.5rem] border-t border-slate-200 bg-white shadow-[0_-12px_34px_rgba(15,23,42,0.16)] outline-none dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-[0_-18px_42px_rgba(0,0,0,0.34)] lg:hidden">
            <Drawer.Title className="sr-only">{t("chat.mobileGenerationSheet")}</Drawer.Title>
            <Drawer.Handle className="mx-auto mt-2 flex h-7 w-24 items-center justify-center rounded-full text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-500 dark:focus-visible:ring-violet-400">
              <span className="h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-600" />
            </Drawer.Handle>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4 pt-2">
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
              {generationBlockedResource ? (
                <ResourceBlockedNotice resource={generationBlockedResource} className="mb-2" />
              ) : null}
              {baseRequirementMessage || resourceGroupRequirementMessage ? (
                <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200">
                  {baseRequirementMessage || resourceGroupRequirementMessage}
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generateDisabled}
                title={generationBlockedTitle ?? t("chat.startGenerate")}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition-colors active:scale-[0.98] hover:bg-indigo-500 disabled:opacity-60 dark:bg-gradient-to-r dark:from-indigo-500 dark:via-violet-500 dark:to-fuchsia-500 dark:shadow-violet-900/45 dark:ring-1 dark:ring-violet-300/35"
              >
                {generateMutation.isPending ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Sparkles size={15} className="mr-2" />}
                {generateMutation.isPending
                  ? t("chat.submitting")
                  : submitGenerationCount > 1
                    ? t("chat.startGenerateCount", { count: submitGenerationCount })
                    : t("chat.startGenerate")}
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      {promptPreview ? (
        <PromptPreviewDialog preview={promptPreview} onClose={() => setPromptPreview(null)} />
      ) : null}
      {activePreviewRound ? (
        <GalleryImagePreviewDialog
          ariaLabel={t("chat.currentPreviewLabel")}
          imageUrl={api.toApiUrl(activePreviewRound.generated_asset.preview_url)}
          imageAlt={activePreviewRound.prompt || t("chat.currentResultAlt")}
          title={t("gallery.prompt")}
          subtitle={activePreviewRound.generated_asset.original_filename}
          body={activePreviewRound.prompt || t("gallery.noPrompt")}
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
      {createSessionDialogOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !createSessionMutation.isPending) {
              setCreateSessionDialogOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={createSessionDialogTitleId}
            aria-describedby={createSessionDialogDescriptionId}
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in"
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
                  <SelectField
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
                    radius="lg"
                    visualSize="sm"
                    disabled={createSessionMutation.isPending || generationResourceGroupsQuery.isLoading}
                  />
                </label>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
              <button
                type="button"
                onClick={() => setCreateSessionDialogOpen(false)}
                disabled={createSessionMutation.isPending}
                className="inline-flex h-9 min-w-[72px] items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmCreateSession}
                disabled={createSessionMutation.isPending || !createSessionResourceGroupId}
                className="inline-flex h-9 min-w-[88px] items-center justify-center rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white shadow-sm shadow-slate-950/15 transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
              >
                {createSessionMutation.isPending ? <Loader2 size={15} className="mr-2 animate-spin" /> : null}
                {t("chat.createSessionConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingDeleteDialog)}
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
    </div>
  );

}
