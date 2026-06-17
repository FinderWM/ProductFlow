import {
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Check,
  Copy,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Save,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { GalleryTagPickerDialog } from "../components/GalleryTagPickerDialog";
import { GalleryImagePreviewDialog } from "../components/GalleryImagePreviewDialog";
import { ModalShell } from "../components/ModalShell";
import { ResourceBlockedNotice, ResourceMetaBadges } from "../components/ResourceGovernance";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { formatDateTime } from "../lib/format";
import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
import {
  API_GALLERY_TAGS_MANAGE,
  API_RESOURCES_MODERATE,
  hasSessionAdminApiPermission,
  hasSessionApiPermission,
} from "../lib/rbac";
import { useSessionState } from "../lib/session";
import type { GalleryEntry, GalleryEntryListResponse, GalleryTag, ResourceModerationResponse } from "../lib/types";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import { galleryEntryAspectRatio, galleryEntrySizeLabel, galleryTileLayout } from "./gallery/helpers";
import { galleryAdminRemovedLabel } from "./gallery/moderation";

const TAG_FILTER_MORE_BUTTON_WIDTH = 104;
const TAG_FILTER_ROW_GAP = 8;

interface GalleryTagFormState {
  name: string;
  description: string;
  priority: string;
}

function estimateGalleryTagButtonWidth(tag: GalleryTag): number {
  return Math.min(260, Math.max(72, tag.name.length * 15 + 44));
}

function visibleGalleryFilterTags(tags: GalleryTag[], availableWidth: number): GalleryTag[] {
  if (!availableWidth || tags.length <= 1) {
    return tags;
  }
  const reservedWidth = TAG_FILTER_MORE_BUTTON_WIDTH + TAG_FILTER_ROW_GAP;
  let usedWidth = 0;
  const visible: GalleryTag[] = [];
  for (const tag of tags) {
    const nextWidth = estimateGalleryTagButtonWidth(tag) + (visible.length ? TAG_FILTER_ROW_GAP : 0);
    if (usedWidth + nextWidth > Math.max(120, availableWidth - reservedWidth)) {
      break;
    }
    visible.push(tag);
    usedWidth += nextWidth;
  }
  return visible.length ? visible : tags.slice(0, 1);
}

function galleryTagChipClass(selected: boolean): string {
  return selected
    ? "inline-flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100"
    : "inline-flex h-8 max-w-full shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-3 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200 dark:hover:border-violet-400/45 dark:hover:bg-violet-500/10";
}

function galleryTagFormFromTag(tag?: GalleryTag | null): GalleryTagFormState {
  return {
    name: tag?.name ?? "",
    description: tag?.description ?? "",
    priority: String(tag?.priority ?? 100),
  };
}

function galleryTagPayloadFromForm(form: GalleryTagFormState): { name: string; description: string | null; priority: number } {
  const parsedPriority = Number.parseInt(form.priority, 10);
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    priority: Number.isFinite(parsedPriority) ? parsedPriority : 100,
  };
}

function metadataRows(
  entry: GalleryEntry,
  locale: ReturnType<typeof useI18n>["locale"],
  t: ReturnType<typeof useI18n>["t"],
  showGenerationResourceGroup: boolean,
) {
  const rows = [
    ["gallery.meta.size", galleryEntrySizeLabel(entry, locale)],
    ["gallery.meta.model", [entry.provider_name, entry.model_name].filter(Boolean).join(" / ") || t("common.unknown")],
    ["gallery.meta.session", entry.image_session_title],
    ["gallery.meta.inspiration", entry.inspiration_name ?? t("gallery.global")],
  ] as Array<readonly [TranslationKey, string]>;
  if (entry.owner_username) {
    rows.push(["gallery.meta.owner", entry.owner_username]);
  }
  if (showGenerationResourceGroup) {
    rows.push(["gallery.meta.resourceGroup", entry.resource_group.name]);
  }
  rows.push(
    [
      "gallery.meta.candidate",
      entry.candidate_index != null && entry.candidate_count != null
        ? `${entry.candidate_index}/${entry.candidate_count}`
        : t("common.unknown"),
    ],
    ["gallery.meta.savedAt", formatDateTime(entry.created_at)],
    ["gallery.meta.views", `${entry.view_count ?? 0}`],
  );
  return rows;
}

function applyGalleryModeration(entry: GalleryEntry, moderation: ResourceModerationResponse): GalleryEntry {
  return {
    ...entry,
    enabled: moderation.enabled,
    disabled_at: moderation.disabled_at,
    disabled_by_user_id: moderation.disabled_by_user_id,
    disabled_by_username: moderation.disabled_by_username,
    disabled_reason: moderation.disabled_reason,
    effective_enabled: moderation.effective_enabled,
    effective_disabled_resource_type: moderation.effective_disabled_resource_type,
    effective_disabled_resource_id: moderation.effective_disabled_resource_id,
    effective_disabled_reason: moderation.effective_disabled_reason,
  };
}

function galleryBaseAssetKindLabel(
  asset: GalleryEntry["base_assets"][number],
  t: ReturnType<typeof useI18n>["t"],
) {
  return t(asset.kind === "generated_image" ? "gallery.generatedBaseImage" : "gallery.referenceBaseImage");
}

interface GalleryPageProps {
  mode?: "auto" | "manage";
}

export function GalleryPage({ mode = "auto" }: GalleryPageProps = {}) {
  const { activeScheme } = useUiLayoutScheme();
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionState();
  const [previewEntry, setPreviewEntry] = useState<GalleryEntry | null>(null);
  const [previewBaseAsset, setPreviewBaseAsset] = useState<GalleryEntry["base_assets"][number] | null>(null);
  const [promptCopyState, setPromptCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [moderationError, setModerationError] = useState("");
  const [gridContentWidth, setGridContentWidth] = useState<number | null>(null);
  const [isDesktopGrid, setIsDesktopGrid] = useState(false);
  const [tagFilterWidth, setTagFilterWidth] = useState(0);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagFilterDialogOpen, setTagFilterDialogOpen] = useState(false);
  const [tagFilterError, setTagFilterError] = useState("");
  const [tagManageOpen, setTagManageOpen] = useState(false);
  const [tagForm, setTagForm] = useState<GalleryTagFormState>(() => galleryTagFormFromTag());
  const [editingTag, setEditingTag] = useState<GalleryTag | null>(null);
  const [tagManageError, setTagManageError] = useState("");
  const [deleteTagTarget, setDeleteTagTarget] = useState<GalleryTag | null>(null);
  const [entryTagEditorEntry, setEntryTagEditorEntry] = useState<GalleryEntry | null>(null);
  const [entryTagEditError, setEntryTagEditError] = useState("");
  const gridRef = useRef<HTMLDivElement | null>(null);
  const tagFilterRef = useRef<HTMLDivElement | null>(null);
  const tagManageTitleId = useId();
  const tagManageDescriptionId = useId();
  const canViewDisabledGallery = hasSessionApiPermission(session, API_RESOURCES_MODERATE);
  const canModerateGallery = hasSessionAdminApiPermission(session, API_RESOURCES_MODERATE);
  const canManageGalleryTags = hasSessionAdminApiPermission(session, API_GALLERY_TAGS_MANAGE);
  const galleryQueryKey = ["gallery", canViewDisabledGallery, selectedTagIds] as const;

  const runtimeConfigQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: api.getRuntimeConfig,
  });
  const showGenerationResourceGroup = runtimeConfigQuery.data?.gallery_show_generation_resource_group ?? true;
  const maxGalleryTagSelection = Math.max(
    1,
    Math.floor(runtimeConfigQuery.data?.gallery_tag_filter_max_selection ?? 10),
  );
  const galleryTagsQuery = useQuery({
    queryKey: ["gallery-tags", "active"],
    queryFn: () => api.listGalleryTags(),
  });
  const manageGalleryTagsQuery = useQuery({
    queryKey: ["gallery-tags", "manage"],
    queryFn: () => api.listGalleryTags({ include_disabled: true }),
    enabled: tagManageOpen && canManageGalleryTags,
  });
  const galleryQuery = useQuery({
    queryKey: galleryQueryKey,
    queryFn: () =>
      api.listGalleryEntries({
        include_disabled: canViewDisabledGallery,
        tag_ids: selectedTagIds,
      }),
  });
  const entries = galleryQuery.data?.items ?? [];
  const galleryTotal = galleryQuery.data?.total ?? entries.length;
  const galleryTags = galleryTagsQuery.data ?? [];
  const manageableGalleryTags = manageGalleryTagsQuery.data ?? [];
  const galleryTagsById = useMemo(() => new Map(galleryTags.map((tag) => [tag.id, tag])), [galleryTags]);
  const selectedTags = selectedTagIds.flatMap((tagId) => {
    const tag = galleryTagsById.get(tagId);
    return tag ? [tag] : [];
  });
  const orderedFilterTags = useMemo(() => {
    const selected = new Set(selectedTagIds);
    return [...selectedTags, ...galleryTags.filter((tag) => !selected.has(tag.id))];
  }, [galleryTags, selectedTagIds, selectedTags]);
  const visibleFilterTags = visibleGalleryFilterTags(orderedFilterTags, tagFilterWidth);
  const hiddenFilterTagCount = Math.max(0, galleryTags.length - visibleFilterTags.length);

  useEffect(() => {
    const updateGridMetrics = () => {
      setIsDesktopGrid(window.matchMedia("(min-width: 1024px)").matches);
      if (gridRef.current) {
        setGridContentWidth(gridRef.current.clientWidth);
      }
    };

    updateGridMetrics();
    window.addEventListener("resize", updateGridMetrics);

    const gridElement = gridRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined" || !gridElement ? null : new ResizeObserver(updateGridMetrics);
    if (gridElement) {
      resizeObserver?.observe(gridElement);
    }

    return () => {
      window.removeEventListener("resize", updateGridMetrics);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const updateTagFilterWidth = () => {
      if (tagFilterRef.current) {
        setTagFilterWidth(tagFilterRef.current.clientWidth);
      }
    };

    updateTagFilterWidth();
    window.addEventListener("resize", updateTagFilterWidth);

    const filterElement = tagFilterRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined" || !filterElement ? null : new ResizeObserver(updateTagFilterWidth);
    if (filterElement) {
      resizeObserver?.observe(filterElement);
    }

    return () => {
      window.removeEventListener("resize", updateTagFilterWidth);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!galleryTagsQuery.data) {
      return;
    }
    const activeTagIds = new Set(galleryTags.map((tag) => tag.id));
    setSelectedTagIds((current) => current.filter((tagId) => activeTagIds.has(tagId)).slice(0, maxGalleryTagSelection));
  }, [galleryTags, galleryTagsQuery.data, maxGalleryTagSelection]);

  useEffect(() => {
    setPromptCopyState("idle");
    setPreviewBaseAsset(null);
  }, [previewEntry?.id]);

  useEffect(() => {
    if (promptCopyState === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setPromptCopyState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [promptCopyState]);

  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login", { replace: true });
    },
  });

  const moderationMutation = useMutation({
    mutationFn: ({ enabled, entry }: { enabled: boolean; entry: GalleryEntry }) =>
      api.updateResourceModeration("image_gallery_entry", entry.id, { enabled }),
    onSuccess: async (moderation, variables) => {
      queryClient.setQueryData<GalleryEntryListResponse | undefined>(galleryQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === variables.entry.id ? applyGalleryModeration(item, moderation) : item,
              ),
            }
          : current,
      );
      setPreviewEntry((current) =>
        current?.id === variables.entry.id ? applyGalleryModeration(current, moderation) : current,
      );
      setModerationError("");
      await queryClient.invalidateQueries({ queryKey: ["gallery"] });
    },
    onError: (error, variables) => {
      setModerationError(
        error instanceof ApiError
          ? error.detail
          : variables.enabled
            ? t("gallery.restoreEntryFailed")
            : t("gallery.removeEntryFailed"),
      );
    },
  });

  const saveGalleryTagMutation = useMutation({
    mutationFn: (form: GalleryTagFormState) => {
      const payload = galleryTagPayloadFromForm(form);
      if (!payload.name) {
        throw new Error(t("gallery.tags.nameRequired"));
      }
      return editingTag
        ? api.updateGalleryTag(editingTag.id, payload)
        : api.createGalleryTag({ ...payload, enabled: true });
    },
    onSuccess: async () => {
      setTagManageError("");
      setEditingTag(null);
      setTagForm(galleryTagFormFromTag());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gallery-tags"] }),
        queryClient.invalidateQueries({ queryKey: ["gallery"] }),
      ]);
    },
    onError: (error) => {
      setTagManageError(
        error instanceof ApiError
          ? error.detail
          : error instanceof Error
            ? error.message
            : t("gallery.tags.updateFailed"),
      );
    },
  });

  const toggleGalleryTagMutation = useMutation({
    mutationFn: (tag: GalleryTag) => api.updateGalleryTag(tag.id, { enabled: !tag.enabled }),
    onSuccess: async () => {
      setTagManageError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gallery-tags"] }),
        queryClient.invalidateQueries({ queryKey: ["gallery"] }),
      ]);
    },
    onError: (error) => {
      setTagManageError(error instanceof ApiError ? error.detail : t("gallery.tags.updateFailed"));
    },
  });

  const deleteGalleryTagMutation = useMutation({
    mutationFn: (tag: GalleryTag) => api.deleteGalleryTag(tag.id),
    onSuccess: async () => {
      setTagManageError("");
      setDeleteTagTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gallery-tags"] }),
        queryClient.invalidateQueries({ queryKey: ["gallery"] }),
      ]);
    },
    onError: (error) => {
      setTagManageError(error instanceof ApiError ? error.detail : t("gallery.tags.deleteFailed"));
    },
  });

  const replaceEntryTagsMutation = useMutation({
    mutationFn: ({ entryId, tagIds }: { entryId: string; tagIds: string[] }) =>
      api.replaceGalleryEntryTags(entryId, tagIds),
    onSuccess: async (updatedEntry) => {
      setEntryTagEditError("");
      setEntryTagEditorEntry(null);
      queryClient.setQueryData<GalleryEntryListResponse | undefined>(galleryQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updatedEntry.id ? updatedEntry : item)),
            }
          : current,
      );
      setPreviewEntry((current) => (current?.id === updatedEntry.id ? updatedEntry : current));
      await queryClient.invalidateQueries({ queryKey: ["gallery"] });
    },
    onError: (error) => {
      setEntryTagEditError(error instanceof ApiError ? error.detail : t("gallery.tags.entryUpdateFailed"));
    },
  });

  const viewMutation = useMutation({
    mutationFn: (entry: GalleryEntry) => api.recordGalleryEntryView(entry.id),
    onSuccess: (result) => {
      queryClient.setQueryData<GalleryEntryListResponse | undefined>(galleryQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === result.id ? { ...item, view_count: result.view_count } : item,
              ),
            }
          : current,
      );
      setPreviewEntry((current) =>
        current?.id === result.id ? { ...current, view_count: result.view_count } : current,
      );
    },
  });

  const handleEntryClick = (entry: GalleryEntry) => {
    setPreviewEntry(entry);
    viewMutation.mutate(entry);
  };

  const handleCopyPreviewPrompt = async () => {
    const prompt = previewEntry?.prompt?.trim();
    if (!prompt) {
      return;
    }
    try {
      await copyTextToClipboard(prompt);
      setPromptCopyState("copied");
    } catch {
      setPromptCopyState("failed");
    }
  };

  const promptCopyTitle =
    promptCopyState === "copied"
      ? t("gallery.promptCopied")
      : promptCopyState === "failed"
        ? t("gallery.promptCopyFailed")
        : t("gallery.copyPrompt");
  const isWorkspaceManage = activeScheme === "workspace" && mode === "manage";

  const handleClosePreview = () => {
    if (previewBaseAsset) {
      setPreviewBaseAsset(null);
      return;
    }
    setPreviewEntry(null);
  };

  const toggleFilterTag = (tag: GalleryTag) => {
    setSelectedTagIds((current) => {
      if (current.includes(tag.id)) {
        setTagFilterError("");
        return current.filter((tagId) => tagId !== tag.id);
      }
      if (current.length >= maxGalleryTagSelection) {
        setTagFilterError(t("gallery.tags.maxSelected", { count: maxGalleryTagSelection }));
        return current;
      }
      setTagFilterError("");
      return [...current, tag.id];
    });
  };

  const openTagManageDialog = () => {
    setTagManageOpen(true);
    setTagManageError("");
    setEditingTag(null);
    setTagForm(galleryTagFormFromTag());
  };

  const closeTagManageDialog = () => {
    if (saveGalleryTagMutation.isPending || toggleGalleryTagMutation.isPending || deleteGalleryTagMutation.isPending) {
      return;
    }
    setTagManageOpen(false);
    setTagManageError("");
    setEditingTag(null);
    setTagForm(galleryTagFormFromTag());
  };

  const handleTagFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveGalleryTagMutation.mutate(tagForm);
  };

  const renderEntryTags = (tags: GalleryTag[], className = "") =>
    tags.length ? (
      <div className={`flex flex-wrap gap-1.5 ${className}`}>
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex max-w-full items-center rounded-md border border-white/15 bg-white/12 px-2 py-0.5 text-[10px] font-semibold text-white/85 backdrop-blur dark:border-violet-400/25 dark:bg-violet-500/15 dark:text-violet-100"
            title={tag.description || tag.name}
          >
            <span className="truncate">{tag.name}</span>
          </span>
        ))}
      </div>
    ) : null;

  const manageTagButton = canManageGalleryTags ? (
    <button
      type="button"
      onClick={openTagManageDialog}
      className={
        isWorkspaceManage
          ? "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:hover:bg-slate-800"
          : "inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 dark:border-white/10 dark:bg-white/10"
      }
    >
      <Tags size={15} />
      {t("gallery.tags.manage")}
    </button>
  ) : null;

  const previewTagFooter = canManageGalleryTags && previewEntry ? (
    <button
      type="button"
      onClick={() => {
        setEntryTagEditorEntry(previewEntry);
        setEntryTagEditError("");
      }}
      className="pf-workspace-action-secondary inline-flex h-9 w-full items-center justify-center rounded-xl border px-3 text-xs font-semibold transition-all"
    >
      <Pencil size={15} className="mr-2" />
      {t("gallery.tags.editEntry")}
    </button>
  ) : null;

  const previewDialog = previewEntry ? (
    <GalleryImagePreviewDialog
      ariaLabel={t("gallery.previewLabel")}
      imageUrl={api.toApiUrl(previewEntry.image.preview_url)}
      imageAlt={previewEntry.prompt ?? previewEntry.image.original_filename}
      title={t("gallery.prompt")}
      subtitle={previewEntry.image.original_filename}
      imageInteractive={!previewBaseAsset}
      body={
        <div className="space-y-4 whitespace-normal">
          <ResourceBlockedNotice resource={previewEntry} />
          <section className="space-y-2">
            <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("gallery.tags.filter")}</div>
            {previewEntry.tags.length ? (
              <div className="flex flex-wrap gap-2">
                {previewEntry.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex max-w-full items-center rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100"
                    title={tag.description || tag.name}
                  >
                    <span className="truncate">{tag.name}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-400 dark:text-slate-500">{t("gallery.tags.noneSelected")}</div>
            )}
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("gallery.prompt")}</div>
              <div className="flex shrink-0 items-center gap-2">
                {promptCopyState !== "idle" ? (
                  <span
                    className={
                      promptCopyState === "copied"
                        ? "text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                        : "text-[11px] font-semibold text-red-700 dark:text-red-300"
                    }
                  >
                    {promptCopyTitle}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={handleCopyPreviewPrompt}
                  disabled={!previewEntry.prompt?.trim()}
                  title={promptCopyTitle}
                  aria-label={t("gallery.copyPrompt")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-500 dark:hover:bg-violet-500/15 dark:hover:text-violet-100 dark:focus-visible:ring-violet-400"
                >
                  {promptCopyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
            <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-200">
              {previewEntry.prompt ?? t("gallery.noPrompt")}
            </div>
          </section>
          {previewEntry.base_assets.length ? (
            <section className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{t("gallery.baseImages")}</div>
              <div className="mt-2 grid gap-2">
                {previewEntry.base_assets.map((asset) => (
                  <button
                    type="button"
                    key={asset.id}
                    onClick={() => setPreviewBaseAsset(asset)}
                    title={t("gallery.baseImagePreviewLabel")}
                    aria-label={`${t("gallery.baseImagePreviewLabel")}: ${asset.original_filename}`}
                    className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-slate-50/80 p-2 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-950/30 dark:hover:border-violet-400/40 dark:hover:bg-violet-500/10 dark:focus-visible:ring-violet-400"
                  >
                    <img
                      src={api.toApiUrl(asset.thumbnail_url)}
                      alt={`${t("gallery.baseImage")}: ${asset.original_filename}`}
                      loading="lazy"
                      decoding="async"
                      className="h-12 w-12 shrink-0 rounded-md bg-slate-100 object-cover dark:bg-slate-900"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                        {asset.original_filename}
                      </div>
                      <div className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {galleryBaseAssetKindLabel(asset, t)}
                      </div>
                      <ResourceMetaBadges resource={asset} className="mt-1" />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      }
      metadataRows={metadataRows(previewEntry, locale, t, showGenerationResourceGroup).map(([label, value]) => ({
        label: t(label),
        value,
      }))}
      providerNotes={previewEntry.provider_notes}
      providerNotesTitle={t("gallery.providerNotes")}
      downloadUrl={previewEntry.image.download_url}
      downloadLabel={t("gallery.download")}
      closeLabel={t("gallery.closePreview")}
      footerExtra={previewTagFooter}
      onClose={handleClosePreview}
    />
  ) : null;
  const baseAssetPreviewDialog = previewBaseAsset ? (
    <GalleryImagePreviewDialog
      ariaLabel={t("gallery.baseImagePreviewLabel")}
      imageUrl={api.toApiUrl(previewBaseAsset.preview_url)}
      imageAlt={previewBaseAsset.original_filename}
      title={t("gallery.baseImage")}
      subtitle={previewBaseAsset.original_filename}
      body={
        <div className="space-y-2 whitespace-normal">
          <ResourceBlockedNotice resource={previewBaseAsset} />
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {galleryBaseAssetKindLabel(previewBaseAsset, t)}
          </div>
          <ResourceMetaBadges resource={previewBaseAsset} />
        </div>
      }
      providerNotesTitle={t("gallery.providerNotes")}
      downloadUrl={previewBaseAsset.download_url}
      downloadLabel={t("gallery.download")}
      closeLabel={t("gallery.closePreview")}
      className="z-[90]"
      onClose={() => setPreviewBaseAsset(null)}
    />
  ) : null;
  return (
    <div className={`${isWorkspaceManage ? "pf-workspace" : "pf-app"} min-h-screen text-slate-950`}>
      <TopNav breadcrumbs={t("gallery.title")} onHome={() => navigate("/inspirations")} onLogout={() => logoutMutation.mutate()} />

      <main className={isWorkspaceManage ? "pf-workspace-subpage flex-1" : "w-full"}>
        <div className={isWorkspaceManage ? "pf-workspace-subpage-frame-shell" : "contents"}>
          <div className={isWorkspaceManage ? "pf-workspace-subpage-frame" : "contents"}>
        {galleryQuery.isLoading ? (
          <div className="flex min-h-[calc(100svh-80px)] items-center justify-center bg-[#f3eadc] text-slate-500">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : galleryQuery.isError ? (
          <div className="flex min-h-[calc(100svh-80px)] items-center justify-center bg-[#f3eadc] px-6 text-sm font-medium text-red-700">
            {t("gallery.loadFailed")}
          </div>
        ) : (
          <>
            {isWorkspaceManage ? (
              <section className="pf-workspace-subpage-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="pf-eyebrow mb-2">{t("gallery.feed")}</div>
                  <h1 className="text-2xl font-semibold tracking-tight">{t("gallery.title")}</h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6">{t("gallery.description")}</p>
                </div>
                <div className="flex flex-col gap-3 sm:items-end">
                  <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{t("gallery.count", { count: galleryTotal })}</div>
                  {manageTagButton}
                </div>
              </section>
            ) : (
            <section className="relative isolate min-h-[420px] overflow-hidden bg-[#f4eddf] sm:min-h-[480px] lg:min-h-[460px]">
              <img
                src="/hero.png"
                alt=""
                decoding="async"
                className="absolute inset-y-0 right-0 h-full w-full object-cover object-center opacity-35 sm:opacity-50 lg:w-[62%] lg:opacity-100"
              />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,#f4eddf_0%,rgba(244,237,223,0.99)_36%,rgba(244,237,223,0.72)_52%,rgba(244,237,223,0.08)_76%,rgba(244,237,223,0)_100%)]" />
              <div className="absolute inset-x-0 bottom-0 h-px bg-[#020617]/10" />
              <div className="absolute left-4 top-16 hidden h-64 flex-col items-center gap-4 text-[#1d4cff] sm:left-6 sm:flex lg:left-8">
                <span className="h-2 w-2 rounded-full bg-[#1d4cff]" />
                <span className="h-28 w-px bg-[#1d4cff]/30" />
                <span className="rounded-full border border-[#1d4cff]/20 bg-[#f4eddf]/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]">
                  Gallery
                </span>
                <span className="h-2 w-2 rounded-full border-2 border-[#1d4cff]" />
              </div>

              <div className="relative z-10 mx-auto grid min-h-[420px] max-w-7xl grid-cols-1 px-6 py-14 sm:min-h-[480px] sm:px-10 lg:min-h-[460px] lg:grid-cols-[minmax(0,0.43fr)_minmax(360px,0.57fr)] lg:items-center lg:px-14">
                <div className="max-w-xl">
                  <div className="mb-7 h-px w-44 bg-[#020617]/22" />
                  <h1 className="text-6xl font-black leading-none text-[#020617] sm:text-7xl lg:text-8xl">
                    {t("gallery.title")}
                  </h1>
                  <p className="mt-6 max-w-md text-base leading-7 text-[#1f2937]">
                    {t("gallery.description")}
                  </p>
                  <div className="mt-7 flex max-w-xs items-center gap-3">
                    <span className="relative h-4 w-4 rounded-full border-2 border-[#020617]">
                      <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#020617]" />
                    </span>
                    <span className="h-px flex-1 bg-[#020617]/18" />
                  </div>
                </div>

                <div className="hidden lg:block" />
              </div>
            </section>
            )}

            <section className={isWorkspaceManage ? "pf-gallery-feed p-0" : "pf-gallery-feed px-4 py-8 sm:px-6 lg:px-10"}>
              {!isWorkspaceManage ? (
              <div className="mx-auto mb-6 flex max-w-7xl flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase text-indigo-300">{t("gallery.feed")}</div>
                  <h2 className="mt-2 text-2xl font-black text-white">{t("gallery.works")}</h2>
                </div>
                <div className="flex flex-col gap-3 sm:items-end">
                  <div className="text-sm font-medium text-white/55">{t("gallery.count", { count: galleryTotal })}</div>
                  {manageTagButton}
                </div>
              </div>
              ) : null}
              <div
                ref={tagFilterRef}
                className="mx-auto mb-4 flex max-w-7xl items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-white/5 px-3 py-2 dark:border-white/10"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  {visibleFilterTags.length ? (
                    visibleFilterTags.map((tag) => {
                      const selected = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleFilterTag(tag)}
                          title={tag.description || tag.name}
                          className={galleryTagChipClass(selected)}
                        >
                          {selected ? <Check size={13} className="shrink-0" /> : <Tags size={13} className="shrink-0" />}
                          <span className="min-w-0 truncate">{tag.name}</span>
                          {selected ? <X size={13} className="shrink-0 opacity-70" /> : null}
                        </button>
                      );
                    })
                  ) : (
                    <span className="text-sm font-medium text-white/55 dark:text-slate-400">
                      {galleryTagsQuery.isLoading ? t("gallery.tags.loading") : t("gallery.tags.noAvailable")}
                    </span>
                  )}
                </div>
                {galleryTags.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTagFilterDialogOpen(true);
                      setTagFilterError("");
                    }}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <MoreHorizontal size={14} />
                    {t("gallery.tags.more")}
                    {hiddenFilterTagCount > 0 ? <span className="text-slate-400">+{hiddenFilterTagCount}</span> : null}
                  </button>
                ) : null}
              </div>
              {tagFilterError ? (
                <div className="mx-auto mb-4 max-w-7xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                  {tagFilterError}
                </div>
              ) : null}
              {moderationError ? (
                <div className="mx-auto mb-4 max-w-7xl rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-100">
                  {moderationError}
                </div>
              ) : null}

              {entries.length ? (
                <div
                  ref={gridRef}
                  className="mx-auto grid max-w-7xl grid-flow-dense grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12 lg:auto-rows-[8px]"
                >
                {entries.map((entry, index) => {
                  const tileLayout = galleryTileLayout(entry, index, gridContentWidth ?? undefined);
                  const adminRemovedLabel = galleryAdminRemovedLabel(entry, t);
                  const moderationEnabled = entry.enabled !== false;
                  const moderationActionLabel = moderationEnabled ? t("gallery.removeEntry") : t("gallery.restoreEntry");
                  const isModeratingEntry = moderationMutation.isPending && moderationMutation.variables?.entry.id === entry.id;
                  const tileStyle: CSSProperties = {
                    aspectRatio: tileLayout.aspectRatio,
                    ...(isDesktopGrid ? { gridRowEnd: `span ${tileLayout.rowSpan}` } : {}),
                  };
                  const imageAspectRatio = galleryEntryAspectRatio(entry);
                  const tileAspectRatio = Number(tileLayout.aspectRatio);
                  const imageFrameStyle: CSSProperties = {
                    aspectRatio: imageAspectRatio.toFixed(4),
                    ...(imageAspectRatio >= tileAspectRatio ? { width: "100%" } : { height: "100%", width: "auto" }),
                  };
                  const handleModerationClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    moderationMutation.mutate({ enabled: !moderationEnabled, entry });
                  };
                  return (
                    <article
                      key={entry.id}
                      className={`group relative min-w-0 overflow-hidden rounded-md bg-transparent text-left shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#0b4eea]/20 ${tileLayout.className}`}
                      style={tileStyle}
                    >
                      <button
                        type="button"
                        onClick={() => handleEntryClick(entry)}
                        className="block h-full w-full text-left"
                      >
                        <div className="flex h-full w-full items-center justify-center overflow-hidden bg-transparent">
                          <div className="relative max-h-full max-w-full overflow-hidden bg-transparent" style={imageFrameStyle}>
                            <img
                              src={api.toApiUrl(entry.image.thumbnail_url)}
                              alt={entry.prompt ?? entry.image.original_filename}
                              loading="lazy"
                              decoding="async"
                              className={`h-full w-full object-cover transition duration-300 ${adminRemovedLabel ? "opacity-55 grayscale" : ""}`}
                            />
                            {adminRemovedLabel ? (
                              <div
                                className="absolute left-3 top-3 z-10 inline-flex max-w-[calc(100%-1.5rem)] items-center rounded-md border border-red-200 bg-red-50/95 px-2 py-1 text-[11px] font-semibold text-red-700 shadow-sm dark:border-red-400/35 dark:bg-red-500/15 dark:text-red-100"
                                title={adminRemovedLabel}
                              >
                                <Ban size={12} className="mr-1.5 shrink-0" aria-hidden="true" />
                                <span className="truncate">{adminRemovedLabel}</span>
                              </div>
                            ) : null}
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[56%] bg-gradient-to-t from-slate-950/82 via-slate-950/12 to-transparent opacity-80 transition-opacity group-hover:opacity-95" />
                            <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                              <div className="line-clamp-2 text-sm font-semibold leading-5">
                                {entry.prompt ?? entry.image.original_filename}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-white/70">
                                <span>{galleryEntrySizeLabel(entry, locale)}</span>
                                {showGenerationResourceGroup ? <span>{entry.resource_group.name}</span> : null}
                                <span>{formatDateTime(entry.created_at)}</span>
                                <span>{t("gallery.views", { count: entry.view_count })}</span>
                              </div>
                              {renderEntryTags(entry.tags, "mt-2")}
                              <ResourceMetaBadges resource={entry} className="mt-2" showReason={Boolean(adminRemovedLabel)} />
                            </div>
                          </div>
                        </div>
                      </button>
                      {canModerateGallery ? (
                        <button
                          type="button"
                          aria-label={moderationActionLabel}
                          title={moderationActionLabel}
                          onClick={handleModerationClick}
                          disabled={isModeratingEntry}
                          className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/20 bg-slate-950/82 text-white shadow-sm backdrop-blur transition-colors hover:bg-slate-800 disabled:opacity-60 dark:border-white/15"
                        >
                          {isModeratingEntry ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : moderationEnabled ? (
                            <Ban size={15} />
                          ) : (
                            <RotateCcw size={15} />
                          )}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
                </div>
              ) : (
                <div className="mx-auto flex min-h-[320px] max-w-7xl flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-sm text-white/65 dark:border-slate-700 dark:bg-slate-950/25 dark:text-slate-400">
                  <ImageIcon size={30} className="mb-4 text-indigo-300" />
                  <div className="text-2xl font-semibold text-white dark:text-white">{t("gallery.title")}</div>
                  <div className="mt-3">{selectedTagIds.length ? t("gallery.tags.filterEmpty") : t("gallery.empty")}</div>
                </div>
              )}

            </section>
          </>
        )}
          </div>
        </div>
      </main>

      {previewDialog}
      {baseAssetPreviewDialog}
      <GalleryTagPickerDialog
        open={tagFilterDialogOpen}
        tags={galleryTags}
        initialSelectedTagIds={selectedTagIds}
        title={t("gallery.tags.filter")}
        description={t("gallery.tags.filterDescription", { count: maxGalleryTagSelection })}
        confirmLabel={t("common.apply")}
        maxSelection={maxGalleryTagSelection}
        error={tagFilterError}
        onConfirm={(tagIds) => {
          setSelectedTagIds(tagIds);
          setTagFilterError("");
          setTagFilterDialogOpen(false);
        }}
        onClose={() => setTagFilterDialogOpen(false)}
      />
      <GalleryTagPickerDialog
        open={Boolean(entryTagEditorEntry)}
        tags={galleryTags}
        initialSelectedTagIds={entryTagEditorEntry?.tags.map((tag) => tag.id) ?? []}
        title={t("gallery.tags.editEntry")}
        description={t("gallery.tags.editEntryDescription", { count: maxGalleryTagSelection })}
        maxSelection={maxGalleryTagSelection}
        busy={replaceEntryTagsMutation.isPending}
        error={entryTagEditError}
        onConfirm={(tagIds) => {
          if (!entryTagEditorEntry) {
            return;
          }
          replaceEntryTagsMutation.mutate({ entryId: entryTagEditorEntry.id, tagIds });
        }}
        onClose={() => {
          if (!replaceEntryTagsMutation.isPending) {
            setEntryTagEditorEntry(null);
            setEntryTagEditError("");
          }
        }}
      />
      {tagManageOpen ? (
        <ModalShell
          open={tagManageOpen}
          onClose={closeTagManageDialog}
          closeDisabled={
            saveGalleryTagMutation.isPending || toggleGalleryTagMutation.isPending || deleteGalleryTagMutation.isPending
          }
          ariaLabelledBy={tagManageTitleId}
          ariaDescribedBy={tagManageDescriptionId}
          overlayClassName="z-[90] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          panelClassName="flex max-h-[min(88svh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <div className="min-w-0">
              <h2 id={tagManageTitleId} className="text-base font-semibold text-slate-950 dark:text-white">
                {t("gallery.tags.manageTitle")}
              </h2>
              <p id={tagManageDescriptionId} className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t("gallery.tags.manageDescription")}
              </p>
            </div>
            <button
              type="button"
              onClick={closeTagManageDialog}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label={t("common.close")}
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-h-0 overflow-y-auto p-5">
              {manageGalleryTagsQuery.isLoading ? (
                <div className="flex min-h-40 items-center justify-center text-slate-400">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              ) : manageableGalleryTags.length ? (
                <div className="space-y-2">
                  {manageableGalleryTags.map((tag) => {
                    const toggling = toggleGalleryTagMutation.isPending && toggleGalleryTagMutation.variables?.id === tag.id;
                    const deleting = deleteGalleryTagMutation.isPending && deleteGalleryTagMutation.variables?.id === tag.id;
                    return (
                      <div
                        key={tag.id}
                        className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/30 sm:grid-cols-[minmax(0,1fr)_auto]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-950 dark:text-white">{tag.name}</span>
                            <span
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                                tag.enabled
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200"
                                  : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                              }`}
                            >
                              {tag.enabled ? t("common.enabled") : t("common.disabled")}
                            </span>
                            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                              {t("gallery.tags.priorityValue", { value: tag.priority })}
                            </span>
                          </div>
                          {tag.description ? (
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                              {tag.description}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 sm:justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTag(tag);
                              setTagForm(galleryTagFormFromTag(tag));
                              setTagManageError("");
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
                            aria-label={t("gallery.tags.edit")}
                            title={t("gallery.tags.edit")}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleGalleryTagMutation.mutate(tag)}
                            disabled={toggling}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
                            aria-label={tag.enabled ? t("gallery.tags.disable") : t("gallery.tags.enable")}
                            title={tag.enabled ? t("gallery.tags.disable") : t("gallery.tags.enable")}
                          >
                            {toggling ? <Loader2 size={14} className="animate-spin" /> : tag.enabled ? <Ban size={14} /> : <RotateCcw size={14} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTagTarget(tag)}
                            disabled={deleting}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-60 dark:border-red-400/35 dark:bg-slate-950/70 dark:text-red-300 dark:hover:bg-red-500/10"
                            aria-label={t("gallery.tags.delete")}
                            title={t("gallery.tags.delete")}
                          >
                            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  {t("gallery.tags.empty")}
                </div>
              )}
            </div>
            <form
              onSubmit={handleTagFormSubmit}
              className="border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/45 md:border-l md:border-t-0"
            >
              <div className="text-sm font-semibold text-slate-950 dark:text-white">
                {editingTag ? t("gallery.tags.edit") : t("gallery.tags.create")}
              </div>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {t("gallery.tags.name")}
                </span>
                <input
                  value={tagForm.name}
                  onChange={(event) => setTagForm((current) => ({ ...current, name: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-violet-400 dark:focus:ring-violet-500/20"
                />
              </label>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {t("gallery.tags.description")}
                </span>
                <textarea
                  value={tagForm.description}
                  onChange={(event) => setTagForm((current) => ({ ...current, description: event.target.value }))}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-violet-400 dark:focus:ring-violet-500/20"
                />
              </label>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {t("gallery.tags.priority")}
                </span>
                <input
                  type="number"
                  value={tagForm.priority}
                  onChange={(event) => setTagForm((current) => ({ ...current, priority: event.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-violet-400 dark:focus:ring-violet-500/20"
                />
              </label>
              {tagManageError ? (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                  {tagManageError}
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {editingTag ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTag(null);
                      setTagForm(galleryTagFormFromTag());
                      setTagManageError("");
                    }}
                    className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {t("common.cancel")}
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={saveGalleryTagMutation.isPending}
                  className="inline-flex h-9 items-center rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
                >
                  {saveGalleryTagMutation.isPending ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
                  {editingTag ? t("common.save") : t("common.create")}
                </button>
              </div>
            </form>
          </div>
        </ModalShell>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTagTarget)}
        title={t("gallery.tags.deleteConfirmTitle")}
        description={deleteTagTarget ? t("gallery.tags.deleteConfirm", { name: deleteTagTarget.name }) : ""}
        confirmLabel={t("gallery.tags.delete")}
        cancelLabel={t("common.cancel")}
        busy={deleteGalleryTagMutation.isPending}
        error={deleteGalleryTagMutation.isError ? tagManageError : ""}
        onConfirm={() => {
          if (deleteTagTarget) {
            deleteGalleryTagMutation.mutate(deleteTagTarget);
          }
        }}
        onClose={() => {
          if (!deleteGalleryTagMutation.isPending) {
            setDeleteTagTarget(null);
          }
        }}
      />
    </div>
  );
}
