import { useEffect, useMemo, useRef, useState } from "react";
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
import { ProductAssociationPanel, SessionReferencePanel } from "./image-chat/ReferencePanels";
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
} from "../lib/types";

const DUPLICATE_GENERATION_SUBMIT_WINDOW_MS = 1800;
const MAX_BRANCH_CONTEXT_IMAGES = 6;
const DESKTOP_RESIZABLE_LAYOUT_QUERY = "(min-width: 1024px)";
const PRODUCT_PICKER_LIST_STALE_TIME_MS = 60_000;
const RUNTIME_CONFIG_STALE_TIME_MS = 5 * 60_000;
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
  targetProductId: string;
  selectedResourceGroupId: string | null;
}

const imageChatRouteStateCache = new Map<string, ImageChatRouteState>();

function getImageChatRouteStateScope(productId: string | undefined): string {
  return productId ? `product:${productId}` : "standalone";
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
  | { kind: "productReference"; assetId: string }
  | { kind: "sessionReference"; sessionId: string; assetId: string };

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
  const { productId } = useParams();
  const isProductMode = Boolean(productId);
  const routeStateScope = getImageChatRouteStateScope(productId);
  const autoCreateTriggered = useRef(false);
  const pendingGeneratedRoundCountRef = useRef<number | null>(null);
  const duplicateSubmitGuardRef = useRef<ImageGenerationSubmitGuard | null>(null);
  const mobileSessionButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileHistoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileSettingsButtonRef = useRef<HTMLButtonElement | null>(null);

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
  const [titleDraft, setTitleDraft] = useState("");
  const [renameEnabled, setRenameEnabled] = useState(false);
  const [targetProductId, setTargetProductId] = useState(
    () => readImageChatRouteState(routeStateScope)?.targetProductId ?? "",
  );
  const [promptPreview, setPromptPreview] = useState<PromptPreview | null>(null);
  const [polishedPrompt, setPolishedPrompt] = useState("");
  const [previewRound, setPreviewRound] = useState<ImageSessionRound | null>(null);
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
      targetProductId,
      selectedResourceGroupId,
    });
  }, [
    branchBaseAssetId,
    draft,
    generationCount,
    routeStateScope,
    selectedGeneratedAssetId,
    selectedResourceGroupId,
    selectedReferenceAssetIds,
    selectedSessionId,
    selectedTaskPlaceholderId,
    settingsTab,
    size,
    targetProductId,
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

  const sessionsQuery = useQuery({
    queryKey: ["image-sessions", productId ?? "standalone"],
    queryFn: () => api.listImageSessions(productId),
  });

  const sessionItems = sessionsQuery.data?.items ?? [];

  const productQuery = useQuery({
    queryKey: ["product", productId],
    queryFn: () => api.getProduct(productId!),
    enabled: isProductMode,
  });

  const productsQuery = useQuery({
    queryKey: ["products", selectedResourceGroupId],
    queryFn: () =>
      api.listProducts({
        resource_group_id: selectedResourceGroupId ?? "",
        page_size: 100,
      }),
    enabled: !isProductMode && Boolean(selectedResourceGroupId),
    placeholderData: keepPreviousData,
    staleTime: PRODUCT_PICKER_LIST_STALE_TIME_MS,
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

  const products = productsQuery.data?.items ?? [];
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
  const currentProduct = isProductMode
    ? (productQuery.data ?? null)
    : (products.find((product) => product.id === targetProductId) ?? null);
  const currentUser = sessionState?.user ?? null;
  const currentProductBlocked = isResourceBlocked(currentProduct);
  const currentProductAdminReadonly = isAdminReadonlyResource(currentUser, currentProduct);
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
    isProductMode && currentProductBlocked
      ? blockedActionMessage(currentProduct)
      : isProductMode && currentProductAdminReadonly
        ? adminReadonlyActionTitle
        : imageChatWritePermissionTitle;

  function blockedActionMessage(resource: ModerationFields | null | undefined) {
    return getResourceBlockedActionTitle(resource, t("resource.blockedAction"));
  }

  useEffect(() => {
    if (!resourceGroups.length) {
      if (selectedResourceGroupId) {
        setSelectedResourceGroupId(null);
      }
      return;
    }
    if (!selectedResourceGroupId || !resourceGroups.some((group) => group.id === selectedResourceGroupId)) {
      setSelectedResourceGroupId(resourceGroups[0].id);
    }
  }, [resourceGroups, selectedResourceGroupId]);

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
    if (!isProductMode && products.length && !targetProductId) {
      setTargetProductId(products[0].id);
    }
  }, [isProductMode, products, targetProductId]);

  const createSessionMutation = useMutation({
    mutationFn: () => {
      if (createSessionBlockedTitle) {
        throw new Error(createSessionBlockedTitle);
      }
      return api.createImageSession(productId ? { product_id: productId } : {});
    },
    onSuccess: async (imageSession) => {
      setSelectedSessionId(imageSession.id);
      resetImageSessionSelection();
      queryClient.setQueryData(["image-session", imageSession.id], imageSession);
      await queryClient.invalidateQueries({ queryKey: ["image-sessions", productId ?? "standalone"] });
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

  useEffect(() => {
    if (sessionsQuery.isLoading || createSessionMutation.isPending) {
      return;
    }
    if (sessionItems.length === 0 && !autoCreateTriggered.current) {
      autoCreateTriggered.current = true;
      if (createSessionBlockedTitle) {
        setErrorMessage(createSessionBlockedTitle);
        return;
      }
      createSessionMutation.mutate();
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
    createSessionBlockedTitle,
    isProductMode,
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
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", productId ?? "standalone"] });
    }
  }, [productId, queryClient, selectedSessionId, sessionStatusQuery.data]);

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
    () => productQuery.data?.source_assets.find((asset) => asset.kind === "original_image") ?? null,
    [productQuery.data],
  );

  const productReferenceImages = useMemo(
    () => productQuery.data?.source_assets.filter((asset) => asset.kind === "reference_image") ?? [],
    [productQuery.data],
  );
  const selectedReferenceBlockedResource = firstBlockedResource(
    sessionReferenceAssets.filter((asset) => selectedReferenceAssetIds.includes(asset.id)),
  );
  const selectedReferenceAssets = sessionReferenceAssets.filter((asset) => selectedReferenceAssetIds.includes(asset.id));
  const generationBlockedResource = firstBlockedResource([
    imageSession,
    isProductMode ? currentProduct : null,
    requiresGenerationBase ? branchBaseRound?.generated_asset : null,
    selectedReferenceBlockedResource,
  ]);
  const generationAdminReadonly = hasAdminReadonlyResource(currentUser, [
    imageSession,
    isProductMode ? currentProduct : null,
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
  const sessionEditBlockedResource = firstBlockedResource([imageSession, isProductMode ? currentProduct : null]);
  const sessionEditAdminReadonly = hasAdminReadonlyResource(currentUser, [imageSession, isProductMode ? currentProduct : null]);
  const productAttachBlockedResource = firstBlockedResource([imageSession, selectedRound?.generated_asset, currentProduct]);
  const productAttachAdminReadonly = hasAdminReadonlyResource(currentUser, [
    imageSession,
    selectedRound?.generated_asset,
    currentProduct,
  ]);
  const sessionOrProductBlockedResource = firstBlockedResource([imageSession, isProductMode ? currentProduct : null]);
  const productReferenceEditBlockedTitle = currentProductAdminReadonly
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
  const productAttachBlockedTitle = productAttachBlockedResource
    ? blockedActionMessage(productAttachBlockedResource)
    : productAttachAdminReadonly
      ? adminReadonlyActionTitle
      : imageChatWritePermissionTitle;
  const sessionListDeletionBlockedTitle =
    isProductMode && currentProductBlocked
      ? blockedActionMessage(currentProduct)
      : isProductMode && currentProductAdminReadonly
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
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", productId ?? "standalone"] });
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
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", productId ?? "standalone"] });
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
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", productId ?? "standalone"] });
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
      const remainingSessions = sessionItems.filter((item) => item.id !== deletedSessionId);
      setPendingDeleteAction(null);
      queryClient.setQueryData<ImageSessionListResponse>(
        ["image-sessions", productId ?? "standalone"],
        (current) => current ? { ...current, items: current.items.filter((item) => item.id !== deletedSessionId) } : current,
      );
      queryClient.removeQueries({ queryKey: ["image-session", deletedSessionId] });
      if (selectedSessionId === deletedSessionId) {
        setSelectedSessionId(remainingSessions[0]?.id ?? null);
        resetImageSessionSelection();
        if (!remainingSessions.length) {
          autoCreateTriggered.current = false;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["image-sessions", productId ?? "standalone"] });
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
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", productId ?? "standalone"] });
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
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", productId ?? "standalone"] });
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
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", productId ?? "standalone"] });
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
    mutationFn: (payload: { assetId: string; target: "reference" | "main_source"; productId?: string }) => {
      assertImageChatActionAllowed(productAttachBlockedTitle);
      return api.attachImageSessionAssetToProduct(selectedSessionId!, payload.assetId, {
        target: payload.target,
        product_id: payload.productId,
      });
    },
    onSuccess: async (response) => {
      setSuccessMessage(response.message);
      setErrorMessage("");
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["product", response.product_id] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.saveProductFailed"));
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

  const deleteProductReferenceMutation = useMutation({
    mutationFn: (assetId: string) => {
      assertImageChatActionAllowed(productReferenceEditBlockedTitle);
      return api.deleteSourceAsset(assetId);
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(["product", updated.id], updated);
      setPendingDeleteAction(null);
      await queryClient.invalidateQueries({ queryKey: ["product", updated.id] });
      if (selectedSessionId) {
        await queryClient.invalidateQueries({ queryKey: ["image-session", selectedSessionId] });
      }
      setSuccessMessage(t("chat.productReferenceDeleted"));
      setErrorMessage("");
    },
    onError: (error) => {
      setPendingDeleteAction(null);
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.productReferenceDeleteFailed"));
    },
  });

  const createSessionDisabled = createSessionMutation.isPending || Boolean(createSessionBlockedTitle);
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
    if (!isProductMode && !targetProductId) {
      setErrorMessage(t("chat.selectProductFirst"));
      return;
    }
    if (productAttachBlockedTitle) {
      setErrorMessage(productAttachBlockedTitle);
      return;
    }
    attachMutation.mutate({
      assetId: selectedRound.generated_asset.id,
      target,
      productId: isProductMode ? productId : targetProductId,
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

  function handleDeleteProductReference(assetId: string) {
    if (deleteProductReferenceMutation.isPending) {
      return;
    }
    if (!deletionEnabled) {
      setErrorMessage(t("chat.deleteDisabled"));
      return;
    }
    const asset = productReferenceImages.find((referenceImage) => referenceImage.id === assetId) ?? null;
    const blockedResource = firstBlockedResource([currentProduct, asset]);
    if (blockedResource) {
      setErrorMessage(blockedActionMessage(blockedResource));
      return;
    }
    if (isAdminReadonlyResource(currentUser, currentProduct)) {
      setErrorMessage(adminReadonlyActionTitle);
      return;
    }
    setPendingDeleteAction({ kind: "productReference", assetId });
  }

  function handleReferenceToggle(assetId: string, checked: boolean) {
    const asset = sessionReferenceAssets.find((referenceAsset) => referenceAsset.id === assetId) ?? null;
    const blockedResource = firstBlockedResource([sessionEditBlockedResource, asset]);
    if (checked && blockedResource) {
      setErrorMessage(blockedActionMessage(blockedResource));
      return;
    }
    if (checked && hasAdminReadonlyResource(currentUser, [imageSession, isProductMode ? currentProduct : null, asset])) {
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
    if (hasAdminReadonlyResource(currentUser, [imageSession, isProductMode ? currentProduct : null, asset])) {
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
        <ProductAssociationPanel
          isProductMode={isProductMode}
          product={productQuery.data}
          products={products}
          targetProductId={targetProductId}
          sourceImage={sourceImage}
          referenceImages={productReferenceImages}
          selectedRound={selectedRound}
          attachBusy={attachMutation.isPending}
          deletingReferenceAssetId={
            deleteProductReferenceMutation.isPending ? (deleteProductReferenceMutation.variables ?? null) : null
          }
          onTargetProductChange={setTargetProductId}
          onDeleteReference={handleDeleteProductReference}
          onAttach={handleAttach}
          saveBlockedTitle={productAttachBlockedTitle}
          editBlockedTitle={productReferenceEditBlockedTitle}
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
                placeholder={isProductMode ? t("chat.productPromptPlaceholder") : t("chat.freePromptPlaceholder")}
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
            : pendingDeleteAction.kind === "productReference"
              ? t("chat.confirmDeleteProductReferenceTitle")
              : t("chat.confirmDeleteSessionReferenceTitle"),
        description:
          pendingDeleteAction.kind === "session"
            ? t("chat.confirmDeleteSession")
            : pendingDeleteAction.kind === "productReference"
              ? t("chat.confirmDeleteProductReference")
              : t("chat.confirmDeleteSessionReference"),
        busy:
          pendingDeleteAction.kind === "session"
            ? deleteSessionMutation.isPending
            : pendingDeleteAction.kind === "productReference"
              ? deleteProductReferenceMutation.isPending
              : deleteSessionReferenceMutation.isPending,
      }
    : null;

  return (
    <div className="pf-workspace flex flex-col text-slate-900 dark:text-slate-100 lg:h-[100dvh] lg:overflow-hidden">
      <TopNav
        breadcrumbs={isProductMode ? `${productQuery.data?.name ?? t("chat.productFallback")} / ${t("chat.breadcrumb")}` : t("chat.breadcrumb")}
        onHome={() => navigate(isProductMode && productId ? `/products/${productId}` : "/products")}
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
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950 dark:text-white">{t("chat.sessions")}</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("chat.count", { count: sessionItems.length })}</div>
              </div>
              <button
                type="button"
                onClick={() => createSessionMutation.mutate()}
                disabled={createSessionDisabled}
                title={createSessionBlockedTitle ?? t("chat.newSession")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-500/20 transition-colors hover:bg-indigo-500 disabled:opacity-60 dark:bg-gradient-to-br dark:from-indigo-500 dark:to-violet-500 dark:shadow-violet-900/35 dark:ring-1 dark:ring-violet-300/30"
                aria-label={t("chat.newSession")}
              >
                {createSessionMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
              </button>
            </div>
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
            {sessionOrProductBlockedResource ? (
              <ResourceBlockedNotice resource={sessionOrProductBlockedResource} className="mb-3" />
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
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800">
              <div>
                <div className="text-sm font-semibold text-slate-950 dark:text-white">{t("chat.sessions")}</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("chat.count", { count: sessionItems.length })}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => createSessionMutation.mutate()}
                  disabled={createSessionDisabled}
                  title={createSessionBlockedTitle ?? t("chat.newSession")}
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
          if (pendingDeleteAction.kind === "productReference") {
            if (productReferenceEditBlockedTitle) {
              setErrorMessage(productReferenceEditBlockedTitle);
              setPendingDeleteAction(null);
              return;
            }
            deleteProductReferenceMutation.mutate(pendingDeleteAction.assetId);
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
