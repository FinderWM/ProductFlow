import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "vaul";
import { Archive, CheckCircle2, Download, Eye, Loader2, Pencil, Plus, Save, Trees, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ClassicTextInput } from "../components/classicInputs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ClipboardImageButton } from "../components/ClipboardImageButton";
import { GalleryImagePreviewDialog } from "../components/GalleryImagePreviewDialog";
import { LayoutActionDropZone } from "../components/LayoutActionDropZone";
import { LayoutActionSurfaceButton } from "../components/LayoutActionSurfaceButton";
import {
  actionButtonClassNameForAppearance,
  actionButtonComponentForAppearance,
  renderActionButtonInner,
  transparentActionToneVars,
  type LayoutActionAppearance,
} from "../components/layoutActionButtons";
import { ModalShell } from "../components/ModalShell";
import { ResourceBlockedNotice, ResourceMetaBadges, isResourceBlocked } from "../components/ResourceGovernance";
import { ResourceGroupChipEditor } from "../components/ResourceGroupChipEditor";
import { TopNav } from "../components/TopNav";
import { WorkspaceTextInput } from "../components/workspaceInputs";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useI18n } from "../lib/preferences";
import type { ResourceLibraryAsset, ResourceLibraryGroup } from "../lib/types";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";

type PendingArchive =
  | { kind: "asset"; id: string; name: string }
  | { kind: "group"; id: string; name: string };

const EMPTY_RESOURCE_LIBRARY_GROUPS: ResourceLibraryGroup[] = [];
const EMPTY_RESOURCE_LIBRARY_ASSETS: ResourceLibraryAsset[] = [];
const RESOURCE_LIBRARY_FEEDBACK_AUTO_DISMISS_MS = 1000;
const RESOURCE_LIBRARY_MOBILE_GROUP_DRAWER_DESKTOP_QUERY = "(min-width: 1024px)";

function shouldUseDesktopResourceLibraryGroupRail(): boolean {
  return typeof window !== "undefined" && window.matchMedia(RESOURCE_LIBRARY_MOBILE_GROUP_DRAWER_DESKTOP_QUERY).matches;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.detail : fallback;
}

function resourceLibraryActionAppearance(workspaceSubpage: boolean): LayoutActionAppearance {
  return workspaceSubpage ? "workspace" : "classic";
}

function resourceLibraryActionButtonComponent(workspaceSubpage: boolean) {
  return actionButtonComponentForAppearance(resourceLibraryActionAppearance(workspaceSubpage));
}

function resourceLibraryActionButtonClassName(
  workspaceSubpage: boolean,
  options?: Parameters<typeof actionButtonClassNameForAppearance>[1],
) {
  return actionButtonClassNameForAppearance(resourceLibraryActionAppearance(workspaceSubpage), options);
}

function sameIds(left: string[], right: string[]): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((value, index) => value === rightSorted[index]);
}

function groupIdsForAsset(asset: ResourceLibraryAsset, groups: ResourceLibraryGroup[]): string[] {
  const availableIds = new Set(groups.map((group) => group.id));
  return asset.group_ids.filter((groupId) => availableIds.has(groupId));
}

function ResourceLibraryFeedbackDialog({
  successMessage,
  errorMessage,
  workspaceSubpage = false,
  onCloseSuccess,
  onCloseError,
}: {
  successMessage: string;
  errorMessage: string;
  workspaceSubpage?: boolean;
  onCloseSuccess: () => void;
  onCloseError: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const PageActionButton = resourceLibraryActionButtonComponent(workspaceSubpage);
  const open = Boolean(successMessage || errorMessage);
  const isError = Boolean(errorMessage);
  const message = errorMessage || successMessage;

  if (!open) {
    return null;
  }

  const Icon = isError ? X : CheckCircle2;

  return (
    <ModalShell
      open={open}
      role={isError ? "alertdialog" : "dialog"}
      onClose={isError ? onCloseError : onCloseSuccess}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      overlayClassName="z-[95] bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      panelClassName="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in"
    >
        <div className="flex items-start gap-3 px-5 py-5">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              isError
                ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200"
                : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-200"
            }`}
          >
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-950 dark:text-white">
              {isError ? t("settings.operationFailed") : t("settings.operationSucceeded")}
            </h2>
            <p id={descriptionId} className="mt-2 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">
              {message}
            </p>
          </div>
          {isError ? (
            <PageActionButton
              type="button"
              onClick={onCloseError}
              preset="secondary"
              size="icon-sm"
              aria-label={t("resourceLibrary.close")}
              title={t("resourceLibrary.close")}
              leadingIcon={<X size={16} />}
            >
            </PageActionButton>
          ) : null}
        </div>
    </ModalShell>
  );
}

interface ResourceLibraryGroupListProps {
  groups: ResourceLibraryGroup[];
  selectedGroupId: string;
  editingGroupId: string | null;
  editingGroupName: string;
  updateGroupPending: boolean;
  updatingGroupId: string | null;
  navClassName: string;
  showGroupActionsAlways?: boolean;
  workspaceSubpage?: boolean;
  groupsLabel: string;
  allGroupsLabel: string;
  cancelLabel: string;
  saveLabel: string;
  renameGroupLabel: string;
  archiveGroupLabel: string;
  onSelectGroup: (groupId: string) => void;
  onEditingGroupNameChange: (name: string) => void;
  onStartEditingGroup: (group: ResourceLibraryGroup) => void;
  onCancelEditingGroup: () => void;
  onSaveGroupName: (groupId: string) => void;
  onArchiveGroup: (group: ResourceLibraryGroup) => void;
}

function ResourceLibraryGroupList({
  groups,
  selectedGroupId,
  editingGroupId,
  editingGroupName,
  updateGroupPending,
  updatingGroupId,
  navClassName,
  showGroupActionsAlways = false,
  workspaceSubpage = false,
  groupsLabel,
  allGroupsLabel,
  cancelLabel,
  saveLabel,
  renameGroupLabel,
  archiveGroupLabel,
  onSelectGroup,
  onEditingGroupNameChange,
  onStartEditingGroup,
  onCancelEditingGroup,
  onSaveGroupName,
  onArchiveGroup,
}: ResourceLibraryGroupListProps) {
  const PageActionButton = resourceLibraryActionButtonComponent(workspaceSubpage);
  const groupNavButtonClassName = (active: boolean, extraClassName = "") =>
    `pf-resource-library-group-nav-item flex min-h-10 w-full items-center px-3 py-2 text-left text-sm ${
      active ? "font-semibold text-slate-950 dark:text-white" : "text-slate-500 dark:text-slate-400"
    } ${extraClassName}`.trim();
  const actionClassName = showGroupActionsAlways
    ? "absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5"
    : "pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 " +
      "group-hover/resource-group-row:pointer-events-auto group-hover/resource-group-row:opacity-100 " +
      "group-focus-within/resource-group-row:pointer-events-auto group-focus-within/resource-group-row:opacity-100";

  return (
    <nav className={navClassName} aria-label={groupsLabel}>
      <button
        type="button"
        onClick={() => onSelectGroup("")}
        aria-current={!selectedGroupId ? "page" : undefined}
        className={groupNavButtonClassName(!selectedGroupId)}
      >
        <span className="min-w-0 whitespace-normal break-words leading-5">{allGroupsLabel}</span>
      </button>
      {groups.map((group) => {
        const editing = editingGroupId === group.id;
        return (
          <div key={group.id} className={`rounded-lg transition-colors ${selectedGroupId === group.id ? "font-semibold" : ""}`}>
            {editing ? (
              <div className="space-y-2 p-2">
                {workspaceSubpage ? (
                  <WorkspaceTextInput
                    id={`resource-library-edit-group-${group.id}`}
                    name={`resource-library-edit-group-${group.id}`}
                    value={editingGroupName}
                    onChange={(event) => onEditingGroupNameChange(event.target.value)}
                    size="compact"
                  />
                ) : (
                  <ClassicTextInput
                    id={`resource-library-edit-group-${group.id}`}
                    name={`resource-library-edit-group-${group.id}`}
                    value={editingGroupName}
                    onChange={(event) => onEditingGroupNameChange(event.target.value)}
                    size="compact"
                  />
                )}
                <div className="flex justify-end gap-1">
                  <PageActionButton type="button" onClick={onCancelEditingGroup} preset="secondary" size="sm">
                    {cancelLabel}
                  </PageActionButton>
                  <PageActionButton
                    type="button"
                    onClick={() => onSaveGroupName(group.id)}
                    disabled={!editingGroupName.trim() || updateGroupPending}
                    preset="secondary"
                    size="sm"
                    loading={updateGroupPending && updatingGroupId === group.id}
                  >
                    {saveLabel}
                  </PageActionButton>
                </div>
              </div>
            ) : (
              <div className="group/resource-group-row relative flex min-h-10 items-center py-1">
                <button
                  type="button"
                  onClick={() => onSelectGroup(group.id)}
                  aria-current={selectedGroupId === group.id ? "page" : undefined}
                  className={groupNavButtonClassName(selectedGroupId === group.id, "min-w-0 flex-1 pr-16")}
                >
                  <span className="block min-w-0 whitespace-normal break-words leading-5">{group.name}</span>
                </button>
                <div className={actionClassName}>
                  <PageActionButton
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartEditingGroup(group);
                    }}
                    preset="secondary"
                    size="icon-sm"
                    aria-label={renameGroupLabel}
                    title={renameGroupLabel}
                    leadingIcon={<Pencil size={13} />}
                  />
                  <PageActionButton
                    onClick={(event) => {
                      event.stopPropagation();
                      onArchiveGroup(group);
                    }}
                    preset="danger"
                    size="icon-sm"
                    aria-label={archiveGroupLabel}
                    title={archiveGroupLabel}
                    leadingIcon={<Archive size={13} />}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function ResourceLibraryCreateGroupDialog({
  open,
  name,
  pending,
  workspaceSubpage = false,
  onNameChange,
  onCreate,
  onClose,
}: {
  open: boolean;
  name: string;
  pending: boolean;
  workspaceSubpage?: boolean;
  onNameChange: (name: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const inputId = useId();
  const PageActionButton = resourceLibraryActionButtonComponent(workspaceSubpage);

  if (!open) {
    return null;
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeDisabled={pending}
      ariaLabelledBy={titleId}
      overlayClassName="z-[85] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      panelClassName="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in"
    >
        <div className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 px-5 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-indigo-600 dark:text-violet-300">
              <Plus size={18} />
            </span>
            <h2 id={titleId} className="truncate text-lg font-semibold text-slate-950 dark:text-white">
              {t("resourceLibrary.createGroup")}
            </h2>
          </div>
          <PageActionButton
            type="button"
            onClick={onClose}
            disabled={pending}
            preset="secondary"
            size="icon-sm"
            aria-label={t("resourceLibrary.close")}
            title={t("resourceLibrary.close")}
            leadingIcon={<X size={16} />}
          >
          </PageActionButton>
        </div>
        <div className="space-y-4 px-5 py-5">
          <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t("resourceLibrary.groupName")}
          </label>
          {workspaceSubpage ? (
            <WorkspaceTextInput
              id={inputId}
              value={name}
              autoFocus
              onChange={(event) => onNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCreate();
                }
              }}
              disabled={pending}
              size="default"
              placeholder={t("resourceLibrary.groupNamePlaceholder")}
            />
          ) : (
            <ClassicTextInput
              id={inputId}
              value={name}
              autoFocus
              onChange={(event) => onNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onCreate();
                }
              }}
              disabled={pending}
              size="default"
              placeholder={t("resourceLibrary.groupNamePlaceholder")}
            />
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <PageActionButton
            onClick={onClose}
            disabled={pending}
            preset="secondary"
            size="md"
          >
            {t("common.cancel")}
          </PageActionButton>
          <PageActionButton
            onClick={onCreate}
            disabled={!name.trim() || pending}
            preset="primary"
            size="md"
            leadingIcon={pending ? undefined : <Plus size={14} />}
            loading={pending}
          >
            {t("resourceLibrary.createGroup")}
          </PageActionButton>
        </div>
    </ModalShell>
  );
}

interface ResourceLibraryPageProps {
  mode?: "auto" | "manage";
}

export function ResourceLibraryPage({ mode = "auto" }: ResourceLibraryPageProps) {
  const { activeScheme } = useUiLayoutScheme();
  const workspaceSubpage = activeScheme === "workspace";

  return <ResourceLibraryManagePage subpage={mode === "manage" || workspaceSubpage} workspaceSubpage={workspaceSubpage} />;
}

function ResourceLibraryManagePage({
  subpage = false,
  workspaceSubpage = false,
}: {
  subpage?: boolean;
  workspaceSubpage?: boolean;
}) {
  const { t } = useI18n();
  const PageActionButton = resourceLibraryActionButtonComponent(workspaceSubpage);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mobileGroupDrawerButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileGroupDrawerRestoreFocusRef = useRef(true);
  const createGroupDialogOpenedFromFloatingRailRef = useRef(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false);
  const [mobileGroupDrawerOpen, setMobileGroupDrawerOpen] = useState(false);
  const [useFloatingGroupRail, setUseFloatingGroupRail] = useState(() => !shouldUseDesktopResourceLibraryGroupRail());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [assetGroupDrafts, setAssetGroupDrafts] = useState<Record<string, string[]>>({});
  const [previewAsset, setPreviewAsset] = useState<ResourceLibraryAsset | null>(null);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const clipboardActionClassName = resourceLibraryActionButtonClassName(workspaceSubpage, {
    preset: "secondary",
    size: "lg",
  });
  const iconActionClassName = resourceLibraryActionButtonClassName(workspaceSubpage, {
    preset: "secondary",
    size: "icon-sm",
  });
  const groupsQuery = useQuery({
    queryKey: ["resource-library-groups"],
    queryFn: api.listResourceLibraryGroups,
  });
  const groups = groupsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_GROUPS;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;

  const assetsQuery = useQuery({
    queryKey: ["resource-library-assets", selectedGroupId || "all"],
    queryFn: () => api.listResourceLibraryAssets({ group_id: selectedGroupId || null }),
  });
  const assets = assetsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_ASSETS;

  useEffect(() => {
    if (selectedGroupId && groupsQuery.isSuccess && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId("");
    }
  }, [groups, groupsQuery.isSuccess, selectedGroupId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const mediaQuery = window.matchMedia(RESOURCE_LIBRARY_MOBILE_GROUP_DRAWER_DESKTOP_QUERY);
    const handleViewportChange = (event?: MediaQueryListEvent) => {
      const useDesktopRail = event?.matches ?? mediaQuery.matches;
      setUseFloatingGroupRail(!useDesktopRail);
      if (useDesktopRail) {
        setMobileGroupDrawerOpen(false);
      }
    };
    handleViewportChange();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleViewportChange);
      return () => mediaQuery.removeEventListener("change", handleViewportChange);
    }
    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  useEffect(() => {
    setAssetGroupDrafts((current) => {
      const next: Record<string, string[]> = {};
      const availableIds = new Set(groups.map((group) => group.id));
      for (const asset of assets) {
        const currentDraft = current[asset.id]?.filter((groupId) => availableIds.has(groupId));
        next[asset.id] = currentDraft?.length ? currentDraft : groupIdsForAsset(asset, groups);
      }
      return next;
    });
  }, [assets, groups]);

  const createGroupMutation = useMutation({
    mutationFn: (name: string) => api.createResourceLibraryGroup({ name, sort_order: groups.length }),
    onSuccess: async (group) => {
      setNewGroupName("");
      setCreateGroupDialogOpen(false);
      if (createGroupDialogOpenedFromFloatingRailRef.current) {
        createGroupDialogOpenedFromFloatingRailRef.current = false;
        focusMobileGroupDrawerTrigger();
      }
      setSelectedGroupId(group.id);
      setMessage(t("resourceLibrary.groupCreated"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-groups"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.createGroupFailed")));
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: (input: { groupId: string; name: string }) =>
      api.updateResourceLibraryGroup(input.groupId, { name: input.name }),
    onSuccess: async () => {
      setEditingGroupId(null);
      setEditingGroupName("");
      setMessage(t("resourceLibrary.groupUpdated"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.updateGroupFailed")));
    },
  });

  const archiveGroupMutation = useMutation({
    mutationFn: (groupId: string) => api.archiveResourceLibraryGroup(groupId),
    onSuccess: async (_, groupId) => {
      if (selectedGroupId === groupId) {
        setSelectedGroupId("");
      }
      setPendingArchive(null);
      setMessage(t("resourceLibrary.groupArchived"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.archiveGroupFailed")));
    },
  });

  const updateAssetGroupsMutation = useMutation({
    mutationFn: (input: { assetId: string; group_ids: string[] }) =>
      api.updateResourceLibraryAssetGroups(input.assetId, { group_ids: input.group_ids }),
    onSuccess: async (asset) => {
      setAssetGroupDrafts((current) => ({ ...current, [asset.id]: asset.group_ids }));
      setMessage(t("resourceLibrary.assetGroupsUpdated"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-source-status"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.updateAssetGroupsFailed")));
    },
  });

  const archiveAssetMutation = useMutation({
    mutationFn: (assetId: string) => api.archiveResourceLibraryAsset(assetId),
    onSuccess: async () => {
      setPendingArchive(null);
      setPreviewAsset(null);
      setMessage(t("resourceLibrary.assetArchived"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-source-status"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.archiveAssetFailed")));
    },
  });
  const uploadAssetsMutation = useMutation({
    mutationFn: (input: { files: File[]; group_ids: string[] }) => api.uploadResourceLibraryAssets(input),
    onSuccess: async (response) => {
      setMessage(t("resourceLibrary.uploadSucceeded", { count: response.items.length }));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-groups"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.uploadFailed")));
    },
  });
  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  const assetCountLabel = useMemo(() => {
    if (assetsQuery.isLoading) {
      return t("resourceLibrary.loading");
    }
    return t("resourceLibrary.assetCount", { count: assets.length });
  }, [assets.length, assetsQuery.isLoading, t]);

  useEffect(() => {
    if (!message) {
      return undefined;
    }
    const timer = window.setTimeout(() => setMessage(""), RESOURCE_LIBRARY_FEEDBACK_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  function focusMobileGroupDrawerTrigger() {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      mobileGroupDrawerButtonRef.current?.focus();
    });
  }

  function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) {
      return;
    }
    createGroupMutation.mutate(name);
  }

  function openCreateGroupDialog() {
    createGroupDialogOpenedFromFloatingRailRef.current = useFloatingGroupRail;
    if (useFloatingGroupRail) {
      mobileGroupDrawerRestoreFocusRef.current = false;
    }
    setNewGroupName("");
    setCreateGroupDialogOpen(true);
    setMobileGroupDrawerOpen(false);
    setMessage("");
    setError("");
  }

  function handleSaveGroupName(groupId: string) {
    const name = editingGroupName.trim();
    if (!name) {
      return;
    }
    updateGroupMutation.mutate({ groupId, name });
  }

  function handleSaveAssetGroups(asset: ResourceLibraryAsset) {
    const draft = assetGroupDrafts[asset.id] ?? [];
    if (!draft.length) {
      setMessage("");
      setError(t("resourceLibrary.groupRequired"));
      return;
    }
    updateAssetGroupsMutation.mutate({ assetId: asset.id, group_ids: draft });
  }

  function handleUploadAssetFiles(files: File[]) {
    if (!files.length || uploadAssetsMutation.isPending) {
      return;
    }
    uploadAssetsMutation.mutate({
      files,
      group_ids: selectedGroupId ? [selectedGroupId] : [],
    });
  }

  function handleStartEditingGroup(group: ResourceLibraryGroup) {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  }

  function handleCancelEditingGroup() {
    setEditingGroupId(null);
    setEditingGroupName("");
  }

  function handleQueueGroupArchive(group: ResourceLibraryGroup) {
    setPendingArchive({ kind: "group", id: group.id, name: group.name });
  }

  function handleSelectMobileGroup(groupId: string) {
    setSelectedGroupId(groupId);
    setMobileGroupDrawerOpen(false);
  }

  function pendingArchiveBusy(): boolean {
    if (!pendingArchive) {
      return false;
    }
    if (pendingArchive.kind === "asset") {
      return archiveAssetMutation.isPending && archiveAssetMutation.variables === pendingArchive.id;
    }
    return archiveGroupMutation.isPending && archiveGroupMutation.variables === pendingArchive.id;
  }

  function confirmPendingArchive() {
    if (!pendingArchive) {
      return;
    }
    if (pendingArchive.kind === "asset") {
      archiveAssetMutation.mutate(pendingArchive.id);
      return;
    }
    archiveGroupMutation.mutate(pendingArchive.id);
  }

  return (
    <div className={`${workspaceSubpage ? "pf-workspace pf-settings-workspace" : "pf-app"} min-h-screen text-slate-950 dark:text-slate-100`}>
      <TopNav
        breadcrumbs={subpage ? t("resourceLibrary.manageTitle") : t("resourceLibrary.title")}
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />
      <main className={workspaceSubpage ? "pf-workspace-subpage flex-1" : "mx-auto max-w-7xl px-4 pb-10 pt-4 sm:px-6 lg:px-8"}>
        <div className={workspaceSubpage ? "pf-workspace-subpage-frame-shell" : "contents"}>
          <div className={workspaceSubpage ? "pf-workspace-subpage-frame" : "contents"}>
        <section className={workspaceSubpage ? "pf-workspace-subpage-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" : "mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-[#0f1726] sm:flex-row sm:items-center sm:justify-between"}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Trees size={20} className="text-emerald-600 dark:text-emerald-300" />
              <span>{subpage ? t("resourceLibrary.manageTitle") : t("resourceLibrary.title")}</span>
            </div>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {(selectedGroup ? selectedGroup.name : t("resourceLibrary.allGroups")) + " · " + assetCountLabel}
            </div>
          </div>
          {!useFloatingGroupRail ? (
            <PageActionButton
              onClick={openCreateGroupDialog}
              preset="primary"
              size="md"
              leadingIcon={<Plus size={14} />}
            >
              {t("resourceLibrary.createGroup")}
            </PageActionButton>
          ) : null}
        </section>

        {useFloatingGroupRail ? (
          <button
            ref={mobileGroupDrawerButtonRef}
            type="button"
            onClick={() => setMobileGroupDrawerOpen(true)}
            className="pf-resource-library-mobile-groups-trigger"
            aria-label={`${t("resourceLibrary.groups")} · ${selectedGroup ? selectedGroup.name : t("resourceLibrary.allGroups")}`}
            title={`${t("resourceLibrary.groups")} · ${selectedGroup ? selectedGroup.name : t("resourceLibrary.allGroups")}`}
          >
            <span className="pf-resource-library-mobile-groups-mark" aria-hidden="true">
              <Trees size={18} />
              {groups.length ? <span className="pf-resource-library-mobile-groups-count">{Math.min(groups.length, 99)}</span> : null}
            </span>
            <span className="text-center text-[11px] font-semibold leading-4">{t("resourceLibrary.groups")}</span>
          </button>
        ) : null}

        <div className={workspaceSubpage ? "pf-side-shell min-h-full" : "grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"}>
          {!useFloatingGroupRail ? (
            <aside className={workspaceSubpage ? "pf-side-rail" : "rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-[#0f1726]"}>
              <div className={workspaceSubpage ? "border-b border-slate-200/60 px-5 py-6 dark:border-slate-700/40" : "mb-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400"}>
                <div className={workspaceSubpage ? "flex items-center gap-3 text-base font-semibold text-slate-950 dark:text-white" : ""}>
                  {workspaceSubpage ? (
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-violet-500/15 dark:text-violet-200">
                      <Trees size={18} />
                    </span>
                  ) : null}
                  <span>{t("resourceLibrary.groups")}</span>
                </div>
              </div>
              <ResourceLibraryGroupList
                groups={groups}
                selectedGroupId={selectedGroupId}
                editingGroupId={editingGroupId}
                editingGroupName={editingGroupName}
                updateGroupPending={updateGroupMutation.isPending}
                updatingGroupId={updateGroupMutation.variables?.groupId ?? null}
                navClassName={workspaceSubpage ? "space-y-1 px-3 py-5" : "space-y-1"}
                workspaceSubpage={workspaceSubpage}
                groupsLabel={t("resourceLibrary.groups")}
                allGroupsLabel={t("resourceLibrary.allGroups")}
                cancelLabel={t("common.cancel")}
                saveLabel={t("common.save")}
                renameGroupLabel={t("resourceLibrary.renameGroup")}
                archiveGroupLabel={t("resourceLibrary.archiveGroup")}
                onSelectGroup={setSelectedGroupId}
                onEditingGroupNameChange={setEditingGroupName}
                onStartEditingGroup={handleStartEditingGroup}
                onCancelEditingGroup={handleCancelEditingGroup}
                onSaveGroupName={handleSaveGroupName}
                onArchiveGroup={handleQueueGroupArchive}
              />
            </aside>
          ) : null}

          <section className={workspaceSubpage ? "pf-side-content px-4 py-5 sm:px-6 lg:px-8" : "min-w-0"}>
            <div className="mb-4 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 shadow-sm dark:border-slate-700 dark:bg-[#0f1726]">
              <div className="mb-3 flex flex-col gap-1">
                <div className="text-sm font-semibold text-slate-950 dark:text-white">
                  {t("resourceLibrary.uploadTitle")}
                </div>
                <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {t("resourceLibrary.uploadHint")}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <LayoutActionDropZone
                  appearance={resourceLibraryActionAppearance(workspaceSubpage)}
                  ariaLabel={t("resourceLibrary.uploadAction")}
                  multiple
                  disabled={uploadAssetsMutation.isPending || groupsQuery.isLoading}
                  size="lg"
                  fullWidth
                  className="min-h-12 cursor-pointer"
                  onFiles={handleUploadAssetFiles}
                >
                  {({ isDragging }) => (
                    <span className="inline-flex items-center">
                      {uploadAssetsMutation.isPending ? (
                        <Loader2 size={15} className="mr-2 animate-spin" />
                      ) : (
                        <Upload size={15} className="mr-2" />
                      )}
                      {isDragging ? t("resourceLibrary.dropUpload") : t("resourceLibrary.uploadAction")}
                    </span>
                  )}
                </LayoutActionDropZone>
                <ClipboardImageButton
                  rootClassName="w-full sm:min-w-72"
                  buttonClassName={`${clipboardActionClassName} min-h-12 w-full`}
                  multiple
                  disabled={uploadAssetsMutation.isPending || groupsQuery.isLoading}
                  label={t("common.pasteImage")}
                  closeLabel={t("common.close")}
                  pasteAreaLabel={t("common.pasteImageTarget")}
                  pasteAreaPlaceholder={t("common.pasteImagePlaceholder")}
                  noImageMessage={t("common.clipboardNoImage")}
                  onFiles={handleUploadAssetFiles}
                  onError={(message) => {
                    setMessage("");
                    setError(message);
                  }}
                />
              </div>
            </div>
            {assetsQuery.isLoading || groupsQuery.isLoading ? (
              <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-[#0f1726]">
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : assetsQuery.isError || groupsQuery.isError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                {t("resourceLibrary.loadFailed")}
              </div>
            ) : assets.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {assets.map((asset) => {
                  const draftGroupIds = assetGroupDrafts[asset.id] ?? groupIdsForAsset(asset, groups);
                  const originalGroupIds = groupIdsForAsset(asset, groups);
                  const dirty = !sameIds(draftGroupIds, originalGroupIds);
                  const assetBlocked = isResourceBlocked(asset);
                  return (
                    <article
                      key={asset.id}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#0f1726]"
                    >
                      <LayoutActionSurfaceButton
                        type="button"
                        appearance={resourceLibraryActionAppearance(workspaceSubpage)}
                        preset="secondary"
                        onClick={() => setPreviewAsset(asset)}
                        toneVars={transparentActionToneVars}
                        className="block w-full overflow-hidden rounded-none bg-slate-100 p-0 dark:bg-slate-950"
                        aria-label={t("detail.previewImage", { alt: asset.original_filename })}
                        title={t("common.preview")}
                      >
                        <img
                          src={api.toApiUrl(asset.thumbnail_url)}
                          alt={asset.original_filename}
                          loading="lazy"
                          decoding="async"
                          className="aspect-square w-full object-cover"
                        />
                      </LayoutActionSurfaceButton>
                      <div className="space-y-3 p-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {asset.original_filename}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {formatDateTime(asset.created_at)}
                          </div>
                        </div>
                        <ResourceMetaBadges resource={asset} showReason />
                        <ResourceGroupChipEditor
                          appearance={resourceLibraryActionAppearance(workspaceSubpage)}
                          groups={groups}
                          selectedIds={draftGroupIds}
                          disabled={assetBlocked || (updateAssetGroupsMutation.isPending && updateAssetGroupsMutation.variables?.assetId === asset.id)}
                          editLabel={t("resourceLibrary.editAssetGroups")}
                          ungroupedLabel={t("resourceLibrary.ungrouped")}
                          moreLabel={(count) => t("resourceLibrary.moreGroups", { count })}
                          listboxAriaLabel={t("resourceLibrary.selectGroups")}
                          noGroupsLabel={t("resourceLibrary.noGroups")}
                          onChange={(nextIds) => {
                            setAssetGroupDrafts((current) => ({
                              ...current,
                              [asset.id]: nextIds,
                            }));
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <PageActionButton
                            type="button"
                            onClick={() => setPreviewAsset(asset)}
                            preset="secondary"
                            size="icon-sm"
                            aria-label={t("common.preview")}
                            title={t("common.preview")}
                            leadingIcon={<Eye size={15} />}
                          />
                          <a
                            href={api.toApiUrl(asset.download_url)}
                            target="_blank"
                            rel="noreferrer"
                            className={iconActionClassName}
                            aria-label={t("common.download")}
                            title={t("common.download")}
                          >
                            {renderActionButtonInner({ leadingIcon: <Download size={15} /> })}
                          </a>
                          <PageActionButton
                            onClick={() => handleSaveAssetGroups(asset)}
                            disabled={
                              !dirty ||
                              !draftGroupIds.length ||
                              assetBlocked ||
                              (updateAssetGroupsMutation.isPending &&
                                updateAssetGroupsMutation.variables?.assetId === asset.id)
                            }
                            preset="primary"
                            size="md"
                            className="min-w-0 flex-1"
                            leadingIcon={
                              updateAssetGroupsMutation.isPending &&
                              updateAssetGroupsMutation.variables?.assetId === asset.id ? undefined : <Save size={14} />
                            }
                            loading={
                              updateAssetGroupsMutation.isPending &&
                              updateAssetGroupsMutation.variables?.assetId === asset.id
                            }
                          >
                            {t("common.save")}
                          </PageActionButton>
                          <PageActionButton
                            type="button"
                            onClick={() => setPendingArchive({ kind: "asset", id: asset.id, name: asset.original_filename })}
                            preset="danger"
                            size="icon-sm"
                            aria-label={t("resourceLibrary.archiveAsset")}
                            title={t("resourceLibrary.archiveAsset")}
                            leadingIcon={<Archive size={15} />}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-[#0f1726] dark:text-slate-400">
                <Trees size={24} className="text-emerald-600 dark:text-emerald-300" />
                <div>{t("resourceLibrary.empty")}</div>
              </div>
            )}
          </section>
        </div>
          </div>
        </div>
      </main>

      {useFloatingGroupRail ? (
        <Drawer.Root
          direction="left"
          open={mobileGroupDrawerOpen}
          onOpenChange={(open) => {
            setMobileGroupDrawerOpen(open);
            if (!open) {
              const shouldRestoreFocus = mobileGroupDrawerRestoreFocusRef.current;
              mobileGroupDrawerRestoreFocusRef.current = true;
              if (shouldRestoreFocus) {
                focusMobileGroupDrawerTrigger();
              }
            }
          }}
        >
          <Drawer.Portal>
            <Drawer.Overlay
              className="fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[2px]"
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
              onClick={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
              onTouchMove={(event) => event.stopPropagation()}
              className="pf-resource-library-mobile-groups-drawer fixed inset-y-0 left-0 z-[71] flex w-[min(84vw,320px)] flex-col border-r outline-none"
            >
              <Drawer.Title className="sr-only">{t("resourceLibrary.groups")}</Drawer.Title>
              <div className="pf-resource-library-mobile-groups-drawer-header px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="pf-resource-library-mobile-groups-mark shrink-0" aria-hidden="true">
                      <Trees size={18} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">{t("resourceLibrary.groups")}</div>
                      <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        {(selectedGroup ? selectedGroup.name : t("resourceLibrary.allGroups")) + " · " + assetCountLabel}
                      </div>
                    </div>
                  </div>
                  <PageActionButton
                    type="button"
                    aria-label={t("resourceLibrary.close")}
                    title={t("resourceLibrary.close")}
                    onClick={() => setMobileGroupDrawerOpen(false)}
                    preset="secondary"
                    size="icon-lg"
                    leadingIcon={<X size={18} />}
                  />
                </div>
                <PageActionButton
                  onClick={openCreateGroupDialog}
                  preset="primary"
                  size="md"
                  fullWidth
                  className="mt-4"
                  leadingIcon={<Plus size={14} />}
                >
                  {t("resourceLibrary.createGroup")}
                </PageActionButton>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <ResourceLibraryGroupList
                  groups={groups}
                  selectedGroupId={selectedGroupId}
                  editingGroupId={editingGroupId}
                  editingGroupName={editingGroupName}
                  updateGroupPending={updateGroupMutation.isPending}
                  updatingGroupId={updateGroupMutation.variables?.groupId ?? null}
                  navClassName="space-y-1 px-3 py-5"
                  showGroupActionsAlways
                  workspaceSubpage={workspaceSubpage}
                  groupsLabel={t("resourceLibrary.groups")}
                  allGroupsLabel={t("resourceLibrary.allGroups")}
                  cancelLabel={t("common.cancel")}
                  saveLabel={t("common.save")}
                  renameGroupLabel={t("resourceLibrary.renameGroup")}
                  archiveGroupLabel={t("resourceLibrary.archiveGroup")}
                  onSelectGroup={handleSelectMobileGroup}
                  onEditingGroupNameChange={setEditingGroupName}
                  onStartEditingGroup={handleStartEditingGroup}
                  onCancelEditingGroup={handleCancelEditingGroup}
                  onSaveGroupName={handleSaveGroupName}
                  onArchiveGroup={handleQueueGroupArchive}
                />
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      ) : null}

      <ResourceLibraryCreateGroupDialog
        open={createGroupDialogOpen}
        name={newGroupName}
        pending={createGroupMutation.isPending}
        workspaceSubpage={workspaceSubpage}
        onNameChange={(name) => {
          setNewGroupName(name);
          setMessage("");
          setError("");
        }}
        onCreate={handleCreateGroup}
        onClose={() => {
          if (!createGroupMutation.isPending) {
            setCreateGroupDialogOpen(false);
            setNewGroupName("");
            if (createGroupDialogOpenedFromFloatingRailRef.current) {
              createGroupDialogOpenedFromFloatingRailRef.current = false;
              focusMobileGroupDrawerTrigger();
            }
          }
        }}
      />
      <ResourceLibraryFeedbackDialog
        successMessage={message}
        errorMessage={error}
        workspaceSubpage={workspaceSubpage}
        onCloseSuccess={() => setMessage("")}
        onCloseError={() => setError("")}
      />
      {previewAsset ? (
        <GalleryImagePreviewDialog
          appearance={resourceLibraryActionAppearance(workspaceSubpage)}
          ariaLabel={t("detail.previewImage", { alt: previewAsset.original_filename })}
          imageUrl={api.toApiUrl(previewAsset.preview_url)}
          imageAlt={previewAsset.original_filename}
          title={t("resourceLibrary.title")}
          subtitle={previewAsset.original_filename}
          body={
            <div className="space-y-3">
              <ResourceBlockedNotice resource={previewAsset} />
              <div>{previewAsset.original_filename}</div>
              <div className="flex flex-wrap gap-1">
                {previewAsset.groups.map((group) => (
                  <span
                    key={group.id}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                  >
                    {group.name}
                  </span>
                ))}
              </div>
            </div>
          }
          metadataRows={[
            { label: t("resourceLibrary.groups"), value: previewAsset.groups.map((group) => group.name).join(" / ") },
            { label: t("chat.generatedAt"), value: formatDateTime(previewAsset.created_at) },
          ]}
          providerNotesTitle={t("gallery.providerNotes")}
          downloadUrl={previewAsset.download_url}
          downloadLabel={t("common.download")}
          closeLabel={t("resourceLibrary.close")}
          onClose={() => setPreviewAsset(null)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingArchive)}
        appearance={resourceLibraryActionAppearance(workspaceSubpage)}
        title={
          pendingArchive?.kind === "group"
            ? t("resourceLibrary.archiveGroup")
            : t("resourceLibrary.archiveAsset")
        }
        description={
          pendingArchive?.kind === "group"
            ? t("resourceLibrary.archiveGroupConfirm", { name: pendingArchive?.name ?? "" })
            : t("resourceLibrary.archiveAssetConfirm", { name: pendingArchive?.name ?? "" })
        }
        confirmLabel={t("resourceLibrary.archive")}
        cancelLabel={t("common.cancel")}
        busy={pendingArchiveBusy()}
        onConfirm={confirmPendingArchive}
        onClose={() => {
          if (!pendingArchiveBusy()) {
            setPendingArchive(null);
          }
        }}
      />
    </div>
  );
}
