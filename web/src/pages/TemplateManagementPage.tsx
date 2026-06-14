import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  CopyPlus,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { ModalShell } from "../components/ModalShell";
import { SelectField } from "../components/SelectField";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { localizeCanvasTemplateSummary } from "../lib/canvasTemplateLocalization";
import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import type {
  CanvasTemplateCategory,
  CanvasTemplateEntryMode,
  CanvasTemplateScope,
  CanvasTemplateSummary,
  UpdateGlobalCanvasTemplateInput,
  UpdateUserTemplateGroupInput,
} from "../lib/types";
import { TemplateGraphPreview } from "./inspiration-detail/TemplateGroupsPanel";

type TemplateManagementMode = "personal" | "global";
type EntryFilter = CanvasTemplateEntryMode | "all";

interface TemplateManagementPageProps {
  mode: TemplateManagementMode;
}

interface CategoryDraft {
  id: string | null;
  name: string;
  sort_order: string;
}

interface TemplateDraft {
  id: string;
  title: string;
  description: string;
  category_id: string;
  sort_order: string;
  enabled: boolean;
  disabled_reason: string;
  review_note: string;
}

interface PendingDelete {
  kind: "category" | "template";
  id: string;
  name: string;
}

interface CopyGlobalDraft {
  template: CanvasTemplateSummary;
  category_id: string;
  title: string;
  description: string;
  sort_order: string;
}

const TEMPLATE_INPUT_CLASS =
  "h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-950 " +
  "placeholder:text-slate-400 outline-none transition-colors focus:border-indigo-500 focus:bg-white " +
  "focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-[#111b2d] " +
  "dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:bg-[#111b2d]";
const TEMPLATE_TEXTAREA_CLASS =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-950 " +
  "placeholder:text-slate-400 outline-none transition-colors focus:border-indigo-500 focus:bg-white " +
  "focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-[#111b2d] " +
  "dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:bg-[#111b2d]";
const TEMPLATE_PANEL_CLASS =
  "pf-settings-bordered-module rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 " +
  "dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25";
const TEMPLATE_FIELD_CARD_CLASS =
  "pf-settings-field-card rounded-xl border border-slate-200 bg-slate-50/70 shadow-none dark:border-slate-700 dark:bg-[#0b1220]";
const TEMPLATE_MAIN_ACTION_CLASS =
  "pf-workspace-action-primary inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border px-3.5 text-xs font-semibold " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const TEMPLATE_SECONDARY_ACTION_CLASS =
  "pf-workspace-action-secondary inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border px-3.5 text-xs font-semibold " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const TEMPLATE_COMPACT_ACTION_CLASS =
  "pf-workspace-action-secondary inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const TEMPLATE_ICON_ACTION_CLASS =
  "pf-workspace-action-secondary inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all " +
  "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const TEMPLATE_DANGER_ACTION_CLASS =
  "pf-danger-action inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border px-3.5 text-xs font-semibold " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const TEMPLATE_DANGER_ICON_ACTION_CLASS =
  "pf-danger-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all " +
  "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
const TEMPLATE_FEEDBACK_AUTO_DISMISS_MS = 1000;

const ENTRY_OPTIONS: Array<{ value: EntryFilter; labelKey: TranslationKey }> = [
  { value: "all", labelKey: "templateManage.entryAll" },
  { value: "image", labelKey: "templateManage.entry.image" },
  { value: "copy", labelKey: "templateManage.entry.copy" },
  { value: "tail", labelKey: "templateManage.entry.tail" },
];

const ENTRY_LABEL_KEYS: Record<CanvasTemplateEntryMode, TranslationKey> = {
  image: "templateManage.entry.image",
  copy: "templateManage.entry.copy",
  tail: "templateManage.entry.tail",
};

function categoryDraft(category?: CanvasTemplateCategory | null): CategoryDraft {
  return {
    id: category?.id ?? null,
    name: category?.name ?? "",
    sort_order: String(category?.sort_order ?? 100),
  };
}

function templateDraft(template: CanvasTemplateSummary): TemplateDraft {
  return {
    id: template.user_template_id ?? template.template_id ?? template.key,
    title: template.title,
    description: template.description ?? "",
    category_id: template.category_id ?? "",
    sort_order: String(template.sort_order ?? 100),
    enabled: template.enabled ?? true,
    disabled_reason: template.disabled_reason ?? "",
    review_note: "",
  };
}

function parseSortOrder(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 100;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function templateAvailabilityLabelKey(template: CanvasTemplateSummary): TranslationKey {
  if (template.review_status === "pending") {
    return "templateManage.statusPending";
  }
  return template.effective_enabled === false ? "templateManage.statusDisabled" : "templateManage.statusEnabled";
}

function templateAvailabilityClassName(template: CanvasTemplateSummary): string {
  if (template.review_status === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-200";
  }
  if (template.effective_enabled === false) {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200";
}

function TemplateManagementFeedbackDialog({
  successMessage,
  errorMessage,
  onCloseSuccess,
  onCloseError,
}: {
  successMessage: string;
  errorMessage: string;
  onCloseSuccess: () => void;
  onCloseError: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const open = Boolean(successMessage || errorMessage);
  const isError = Boolean(errorMessage);
  const message = errorMessage || successMessage;

  useEffect(() => {
    if (!successMessage || isError) {
      return undefined;
    }
    const timer = window.setTimeout(onCloseSuccess, TEMPLATE_FEEDBACK_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [isError, onCloseSuccess, successMessage]);

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
            <button
              type="button"
              onClick={onCloseError}
              className={TEMPLATE_ICON_ACTION_CLASS}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
    </ModalShell>
  );
}

export function TemplateManagementPage({ mode }: TemplateManagementPageProps) {
  const { locale, t } = useI18n();
  const { activeScheme } = useUiLayoutScheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scope: CanvasTemplateScope = mode === "global" ? "global" : "user";
  const [search, setSearch] = useState("");
  const [entryFilter, setEntryFilter] = useState<EntryFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [categoryEditor, setCategoryEditor] = useState<CategoryDraft>(() => categoryDraft());
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, TemplateDraft>>({});
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [copyGlobalDraft, setCopyGlobalDraft] = useState<CopyGlobalDraft | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");
  const normalizedSearch = search.trim();

  const templatesQuery = useQuery({
    queryKey: ["canvas-templates", "manage", normalizedSearch, categoryFilter, scope, mode],
    queryFn: () =>
      api.listManageCanvasTemplates({
        search: normalizedSearch || undefined,
        category_id: mode === "personal" ? categoryFilter || undefined : undefined,
        scope: mode === "global" ? undefined : scope,
      }),
  });
  const categoriesQuery = useQuery({
    queryKey: ["canvas-template-categories", "manage", scope],
    queryFn: () => api.listManageCanvasTemplateCategories({ scope }),
  });
  const globalCategoriesQuery = useQuery({
    queryKey: ["canvas-template-categories", "manage", "global"],
    queryFn: () => api.listManageCanvasTemplateCategories({ scope: "global" }),
    enabled: mode === "global",
  });

  const categories = categoriesQuery.data?.items ?? [];
  const globalCategories = globalCategoriesQuery.data?.items ?? [];
  const templates = useMemo(
    () =>
      (templatesQuery.data?.items ?? [])
        .filter((template) => template.kind === "full_canvas")
        .filter((template) => {
          if (!categoryFilter || mode === "personal") {
            return true;
          }
          return template.scope === "user" || template.category_id === categoryFilter;
        })
        .filter((template) => entryFilter === "all" || template.entry_mode === entryFilter)
        .map((template) => localizeCanvasTemplateSummary(template, locale)),
    [categoryFilter, entryFilter, locale, mode, templatesQuery.data?.items],
  );

  const invalidateTemplateData = async () => {
    await queryClient.invalidateQueries({ queryKey: ["canvas-templates"] });
    await queryClient.invalidateQueries({ queryKey: ["canvas-template-categories"] });
  };

  const saveCategoryMutation = useMutation({
    mutationFn: () => {
      const name = categoryEditor.name.trim();
      if (!name) {
        throw new Error(t("templateManage.categoryName"));
      }
      const payload = { name, sort_order: parseSortOrder(categoryEditor.sort_order) };
      return categoryEditor.id
        ? api.updateCanvasTemplateCategory(scope, categoryEditor.id, payload)
        : api.createCanvasTemplateCategory(scope, payload);
    },
    onSuccess: async () => {
      setCategoryEditor(categoryDraft());
      setCategoryEditorOpen(false);
      setSavedMessage(t("templateManage.saved"));
      setError("");
      await invalidateTemplateData();
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(apiErrorMessage(mutationError, t("templateManage.failed")));
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: ({ template, draft }: { template: CanvasTemplateSummary; draft: TemplateDraft }) => {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        category_id: draft.category_id || null,
        sort_order: parseSortOrder(draft.sort_order),
        enabled: draft.enabled,
      };
      if (mode === "global") {
        if (template.scope === "global") {
          const globalPayload: UpdateGlobalCanvasTemplateInput = {
            ...payload,
            disabled_reason: draft.enabled ? null : draft.disabled_reason.trim() || null,
          };
          return api.updateGlobalCanvasTemplate(draft.id, globalPayload);
        }
        const userPayload: UpdateUserTemplateGroupInput = {
          enabled: draft.enabled,
          disabled_reason: draft.enabled ? null : draft.disabled_reason.trim() || null,
        };
        return api.updateUserTemplateGroup(template.user_template_id ?? draft.id, userPayload);
      }
      const userPayload: UpdateUserTemplateGroupInput = {
        ...payload,
        review_note: draft.review_note.trim() || null,
      };
      return api.updateUserTemplateGroup(template.user_template_id ?? draft.id, userPayload);
    },
    onSuccess: async () => {
      setSavedMessage(t("templateManage.saved"));
      setError("");
      await invalidateTemplateData();
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(apiErrorMessage(mutationError, t("templateManage.failed")));
    },
  });

  const archiveCategoryMutation = useMutation({
    mutationFn: (categoryId: string) => api.archiveCanvasTemplateCategory(scope, categoryId),
    onSuccess: async () => {
      setPendingDelete(null);
      setSavedMessage(t("templateManage.saved"));
      setError("");
      await invalidateTemplateData();
    },
    onError: (mutationError) => {
      setPendingDelete(null);
      setSavedMessage("");
      setError(apiErrorMessage(mutationError, t("templateManage.failed")));
    },
  });

  const archiveTemplateMutation = useMutation({
    mutationFn: (template: CanvasTemplateSummary) =>
      mode === "global"
        ? api.archiveGlobalCanvasTemplate(template.template_id ?? template.key)
        : api.archiveUserTemplateGroup(template.user_template_id ?? template.template_id ?? template.key),
    onSuccess: async () => {
      setPendingDelete(null);
      setSavedMessage(t("templateManage.saved"));
      setError("");
      await invalidateTemplateData();
    },
    onError: (mutationError) => {
      setPendingDelete(null);
      setSavedMessage("");
      setError(apiErrorMessage(mutationError, t("templateManage.failed")));
    },
  });

  const copyToGlobalMutation = useMutation({
    mutationFn: () => {
      if (!copyGlobalDraft?.category_id) {
        throw new Error(t("templateManage.globalCategoryRequired"));
      }
      return api.copyUserTemplateToGlobal(copyGlobalDraft.template.user_template_id ?? copyGlobalDraft.template.template_id ?? "", {
        category_id: copyGlobalDraft.category_id,
        title: copyGlobalDraft.title.trim() || undefined,
        description: copyGlobalDraft.description.trim() || undefined,
        sort_order: copyGlobalDraft.sort_order.trim() ? parseSortOrder(copyGlobalDraft.sort_order) : undefined,
      });
    },
    onSuccess: async () => {
      setCopyGlobalDraft(null);
      setSavedMessage(t("templateManage.saved"));
      setError("");
      await invalidateTemplateData();
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(apiErrorMessage(mutationError, t("templateManage.failed")));
    },
  });

  const reviewTemplateMutation = useMutation({
    mutationFn: ({ template, approved }: { template: CanvasTemplateSummary; approved: boolean }) =>
      api.reviewUserTemplateGroup(template.user_template_id ?? template.template_id ?? "", {
        approved,
        disabled_reason: approved
          ? null
          : (templateDrafts[template.key] ?? templateDraft(template)).disabled_reason.trim() ||
            template.disabled_reason ||
            null,
      }),
    onSuccess: async () => {
      setSavedMessage(t("templateManage.saved"));
      setError("");
      await invalidateTemplateData();
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(apiErrorMessage(mutationError, t("templateManage.failed")));
    },
  });

  const pageTitle = mode === "global" ? t("templateManage.globalTitle") : t("templateManage.personalTitle");
  const pageDescription = mode === "global" ? t("templateManage.globalDescription") : t("templateManage.personalDescription");
  const backPath = mode === "global" ? "/settings" : "/inspirations/new";
  const backLabel = mode === "global" ? t("templateManage.backToSettings") : t("templateManage.backToCreate");
  const loading = templatesQuery.isLoading || categoriesQuery.isLoading || globalCategoriesQuery.isLoading;
  const loadFailed = templatesQuery.isError || categoriesQuery.isError || globalCategoriesQuery.isError;
  const isWorkspaceSubpage = activeScheme === "workspace";

  return (
    <div className={`${isWorkspaceSubpage ? "pf-workspace pf-settings-workspace" : "pf-app"} min-h-[100dvh] text-slate-900 dark:text-slate-100`}>
      <TopNav breadcrumbs={pageTitle} />
      <main className={isWorkspaceSubpage ? "pf-workspace-subpage flex-1" : "mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8"}>
        <div className={isWorkspaceSubpage ? "pf-workspace-subpage-frame-shell w-full" : "contents"}>
          <div className={isWorkspaceSubpage ? "pf-workspace-subpage-frame" : "contents"}>
        <header className={isWorkspaceSubpage ? "pf-workspace-subpage-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between" : "mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between"}>
          <div>
            <div className="pf-eyebrow mb-2">
              <Layers3 size={13} className="mr-1.5" />
              {mode === "global" ? t("nav.globalTemplates") : t("nav.templates")}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{pageTitle}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{pageDescription}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className={TEMPLATE_SECONDARY_ACTION_CLASS}
          >
            <ArrowLeft size={15} className="mr-2" />
            {backLabel}
          </button>
        </header>

        {loadFailed ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
            {t("templateManage.loadFailed")}
          </div>
        ) : null}

        <div className={isWorkspaceSubpage ? "pf-side-shell min-h-full" : "grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]"}>
          <aside className={isWorkspaceSubpage ? "pf-side-rail space-y-5 px-4 py-5 sm:px-5" : "space-y-5"}>
            <section className={TEMPLATE_PANEL_CLASS}>
              <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("templateFilter.search")}</h2>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {t("templateFilter.search")}
                  </span>
                  <span className="relative block">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className={`${TEMPLATE_INPUT_CLASS} pl-9`}
                      placeholder={t("templateFilter.searchPlaceholder")}
                    />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {t("templateManage.entry")}
                  </span>
                  <SelectField
                    value={entryFilter}
                    options={ENTRY_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                    onChange={(value) => setEntryFilter(value as EntryFilter)}
                    radius="lg"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {t("templateFilter.category")}
                  </span>
                  <SelectField
                    value={categoryFilter}
                    options={[
                      { value: "", label: t("templateFilter.allCategories") },
                      ...categories.map((category) => ({ value: category.id, label: category.name })),
                    ]}
                    onChange={setCategoryFilter}
                    radius="lg"
                    disabled={categoriesQuery.isLoading}
                  />
                </label>
              </div>
            </section>

            <section className={TEMPLATE_PANEL_CLASS}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("templateManage.categoryPanel")}</h2>
                <button
                  type="button"
                  onClick={() => {
                    setCategoryEditor(categoryDraft());
                    setCategoryEditorOpen(true);
                  }}
                  className={TEMPLATE_MAIN_ACTION_CLASS}
                >
                  <Plus size={13} className="mr-1.5" />
                  {t("templateManage.categoryCreate")}
                </button>
              </div>
              {categoryEditorOpen ? (
                <form
                  className={`${TEMPLATE_FIELD_CARD_CLASS} mt-4 grid gap-3 p-3`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveCategoryMutation.mutate();
                  }}
                >
                  <input
                    value={categoryEditor.name}
                    onChange={(event) => setCategoryEditor((current) => ({ ...current, name: event.target.value }))}
                    className={TEMPLATE_INPUT_CLASS}
                    placeholder={t("templateManage.categoryName")}
                    maxLength={120}
                  />
                  <input
                    type="number"
                    value={categoryEditor.sort_order}
                    onChange={(event) => setCategoryEditor((current) => ({ ...current, sort_order: event.target.value }))}
                    className={TEMPLATE_INPUT_CLASS}
                    placeholder={t("templateManage.categorySort")}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCategoryEditorOpen(false)}
                      className={TEMPLATE_COMPACT_ACTION_CLASS}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={saveCategoryMutation.isPending || !categoryEditor.name.trim()}
                      className={TEMPLATE_MAIN_ACTION_CLASS}
                    >
                      {saveCategoryMutation.isPending ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : null}
                      {t("templateManage.categorySave")}
                    </button>
                  </div>
                </form>
              ) : null}
              <div className="mt-4 space-y-2">
                {categories.length ? (
                  categories.map((category) => (
                    <div
                      key={category.id}
                      className={`${TEMPLATE_FIELD_CARD_CLASS} flex items-center gap-2 px-3 py-2`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{category.name}</div>
                        <div className="mt-0.5 text-xs text-slate-400">{category.sort_order}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryEditor(categoryDraft(category));
                          setCategoryEditorOpen(true);
                        }}
                        className={TEMPLATE_ICON_ACTION_CLASS}
                        aria-label={t("templateManage.categorySave")}
                        title={t("templateManage.categorySave")}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete({ kind: "category", id: category.id, name: category.name })}
                        className={TEMPLATE_DANGER_ICON_ACTION_CLASS}
                        aria-label={t("templateManage.categoryDelete")}
                        title={t("templateManage.categoryDelete")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {t("templateManage.categoryEmpty")}
                  </div>
                )}
              </div>
            </section>
          </aside>

          <section className={isWorkspaceSubpage ? "pf-side-content min-w-0 px-4 py-5 sm:px-6 lg:px-8" : "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25"}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("templateManage.templatePanel")}</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("templateFilter.scope")}: {mode === "global" ? t("templateFilter.scopeGlobal") : t("templateFilter.scopeUser")}
                </p>
              </div>
              {loading ? <Loader2 size={18} className="animate-spin text-slate-400" /> : null}
            </div>

            {!templates.length && !loading ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center dark:border-slate-700 dark:bg-[#0b1220]">
                <Layers3 size={34} className="text-slate-400" />
                <div className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">{t("templateManage.templateEmpty")}</div>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {templates.map((template) => {
                  const draft = templateDrafts[template.key] ?? templateDraft(template);
                  const templateId = template.user_template_id ?? template.template_id ?? template.key;
                  const isUserTemplate = template.scope === "user" && Boolean(template.user_template_id);
                  const canEditTemplate = mode === "personal" ? isUserTemplate : template.scope === "global";
                  const canManageAvailability = mode === "global";
                  const requiresReviewNote =
                    mode === "personal" && isUserTemplate && template.effective_enabled === false;
                  return (
                    <article
                      key={template.key}
                      className={`${TEMPLATE_FIELD_CARD_CLASS} overflow-hidden`}
                    >
                      <div className="border-b border-slate-200 dark:border-slate-700">
                        <TemplateGraphPreview template={template} />
                      </div>
                      <div className="space-y-3 p-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100">
                            {t(ENTRY_LABEL_KEYS[template.entry_mode])}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-300">
                            {template.category_name ?? t("templateFilter.allCategories")}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-300">
                            {t("templateManage.nodeCount", { count: template.preview_nodes.length })}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-300">
                            {t("templateManage.edgeCount", { count: template.preview_edges.length })}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${templateAvailabilityClassName(template)}`}
                          >
                            {t(templateAvailabilityLabelKey(template))}
                          </span>
                          {template.owner_username ? (
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-300">
                              {t("templateManage.owner", { name: template.owner_username })}
                            </span>
                          ) : null}
                        </div>
                        {template.disabled_reason ? (
                          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200">
                            {t("templateManage.disabledReason", { reason: template.disabled_reason })}
                          </div>
                        ) : null}
                        {template.review_note ? (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-100">
                            {t("templateManage.reviewNote", { note: template.review_note })}
                          </div>
                        ) : null}
                        <input
                          value={draft.title}
                          onChange={(event) =>
                            setTemplateDrafts((current) => ({
                              ...current,
                              [template.key]: { ...draft, title: event.target.value },
                            }))
                          }
                          readOnly={!canEditTemplate}
                          className={`${TEMPLATE_INPUT_CLASS} font-semibold`}
                          placeholder={t("templateManage.templateTitle")}
                          maxLength={255}
                        />
                        <textarea
                          value={draft.description}
                          onChange={(event) =>
                            setTemplateDrafts((current) => ({
                              ...current,
                              [template.key]: { ...draft, description: event.target.value },
                            }))
                          }
                          readOnly={!canEditTemplate}
                          className={`${TEMPLATE_TEXTAREA_CLASS} min-h-20 resize-y`}
                          placeholder={t("templateManage.templateDescription")}
                          maxLength={1000}
                        />
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                          <SelectField
                            value={draft.category_id}
                            options={[
                              { value: "", label: t("templateFilter.allCategories") },
                              ...categories.map((category) => ({ value: category.id, label: category.name })),
                            ]}
                            onChange={(value) =>
                              setTemplateDrafts((current) => ({
                                ...current,
                                [template.key]: { ...draft, category_id: value },
                              }))
                            }
                            ariaLabel={t("templateManage.templateCategory")}
                            radius="lg"
                            visualSize="sm"
                            disabled={!canEditTemplate}
                          />
                          <input
                            type="number"
                            value={draft.sort_order}
                            onChange={(event) =>
                              setTemplateDrafts((current) => ({
                                ...current,
                                [template.key]: { ...draft, sort_order: event.target.value },
                              }))
                            }
                            readOnly={!canEditTemplate}
                            className={`${TEMPLATE_INPUT_CLASS} h-9`}
                            placeholder={t("templateManage.templateSort")}
                          />
                        </div>
                        {canManageAvailability ? (
                          <div className={`${TEMPLATE_FIELD_CARD_CLASS} space-y-2 px-3 py-2`}>
                            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                              <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(event) =>
                                  setTemplateDrafts((current) => ({
                                    ...current,
                                    [template.key]: { ...draft, enabled: event.target.checked },
                                  }))
                                }
                                className="h-4 w-4 accent-indigo-600"
                              />
                              {t("templateManage.templateEnabled")}
                            </label>
                            {!draft.enabled ? (
                              <textarea
                                value={draft.disabled_reason}
                                onChange={(event) =>
                                  setTemplateDrafts((current) => ({
                                    ...current,
                                    [template.key]: { ...draft, disabled_reason: event.target.value },
                                  }))
                                }
                                className={`${TEMPLATE_TEXTAREA_CLASS} min-h-16 resize-y text-xs leading-5`}
                                placeholder={t("templateManage.disabledReasonPlaceholder")}
                                maxLength={1000}
                              />
                            ) : null}
                          </div>
                        ) : null}
                        {requiresReviewNote ? (
                          <textarea
                            value={draft.review_note}
                            onChange={(event) =>
                              setTemplateDrafts((current) => ({
                                ...current,
                                [template.key]: { ...draft, review_note: event.target.value },
                              }))
                            }
                            className={`${TEMPLATE_TEXTAREA_CLASS} min-h-16 resize-y border-amber-200 bg-amber-50 text-xs leading-5 text-amber-950 focus:border-amber-400 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100`}
                            placeholder={t("templateManage.reviewNotePlaceholder")}
                            maxLength={1000}
                          />
                        ) : null}
                        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                          {mode === "global" && isUserTemplate ? (
                            <button
                              type="button"
                              onClick={() =>
                                setCopyGlobalDraft({
                                  template,
                                  category_id: globalCategories[0]?.id ?? "",
                                  title: template.title,
                                  description: template.description ?? "",
                                  sort_order: String(template.sort_order ?? 100),
                                })
                              }
                              className={TEMPLATE_SECONDARY_ACTION_CLASS}
                            >
                              <CopyPlus size={13} className="mr-1.5" />
                              {t("templateManage.copyGlobal")}
                            </button>
                          ) : null}
                          {mode === "global" && isUserTemplate && template.review_status === "pending" ? (
                            <>
                              <button
                                type="button"
                                disabled={reviewTemplateMutation.isPending || !templateId}
                                onClick={() => reviewTemplateMutation.mutate({ template, approved: false })}
                                className={TEMPLATE_SECONDARY_ACTION_CLASS}
                              >
                                {t("templateManage.reviewReject")}
                              </button>
                              <button
                                type="button"
                                disabled={reviewTemplateMutation.isPending || !templateId}
                                onClick={() => reviewTemplateMutation.mutate({ template, approved: true })}
                                className={TEMPLATE_MAIN_ACTION_CLASS}
                              >
                                {t("templateManage.reviewApprove")}
                              </button>
                            </>
                          ) : null}
                          {canManageAvailability && !canEditTemplate ? (
                            <button
                              type="button"
                              disabled={saveTemplateMutation.isPending || !templateId}
                              onClick={() => saveTemplateMutation.mutate({ template, draft })}
                              className={TEMPLATE_MAIN_ACTION_CLASS}
                            >
                              {saveTemplateMutation.isPending ? (
                                <Loader2 size={13} className="mr-1.5 animate-spin" />
                              ) : (
                                <Save size={13} className="mr-1.5" />
                              )}
                              {t("templateManage.templateSave")}
                            </button>
                          ) : null}
                          {canEditTemplate ? (
                            <>
                              {mode === "personal" ? (
                                <button
                                  type="button"
                                  onClick={() => setPendingDelete({ kind: "template", id: template.key, name: template.title })}
                                  className={TEMPLATE_DANGER_ACTION_CLASS}
                                >
                                  <Trash2 size={13} className="mr-1.5" />
                                  {t("templateManage.templateDelete")}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={
                                  saveTemplateMutation.isPending ||
                                  !draft.title.trim() ||
                                  !templateId ||
                                  (requiresReviewNote && !draft.review_note.trim())
                                }
                                onClick={() => saveTemplateMutation.mutate({ template, draft })}
                                className={TEMPLATE_MAIN_ACTION_CLASS}
                              >
                                {saveTemplateMutation.isPending ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Save size={13} className="mr-1.5" />}
                                {t("templateManage.templateSave")}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
          </div>
        </div>
      </main>

      <TemplateManagementFeedbackDialog
        successMessage={savedMessage}
        errorMessage={error}
        onCloseSuccess={() => setSavedMessage("")}
        onCloseError={() => setError("")}
      />

      {copyGlobalDraft ? (
        <CopyGlobalDialog
          draft={copyGlobalDraft}
          categories={globalCategories}
          busy={copyToGlobalMutation.isPending}
          onDraftChange={setCopyGlobalDraft}
          onClose={() => setCopyGlobalDraft(null)}
          onConfirm={() => copyToGlobalMutation.mutate()}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={
          pendingDelete?.kind === "category"
            ? t("templateManage.confirmDeleteCategoryTitle")
            : t("templateManage.confirmDeleteTemplateTitle")
        }
        description={
          pendingDelete?.kind === "category"
            ? t("templateManage.confirmDeleteCategory", { name: pendingDelete.name })
            : t("templateManage.confirmDeleteTemplate", { name: pendingDelete?.name ?? "" })
        }
        confirmLabel={t("templateManage.confirmRemove")}
        cancelLabel={t("common.cancel")}
        busy={archiveCategoryMutation.isPending || archiveTemplateMutation.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) {
            return;
          }
          if (pendingDelete.kind === "category") {
            archiveCategoryMutation.mutate(pendingDelete.id);
            return;
          }
          const template = templates.find((item) => item.key === pendingDelete.id);
          if (template) {
            archiveTemplateMutation.mutate(template);
          }
        }}
      />
    </div>
  );
}

function CopyGlobalDialog({
  draft,
  categories,
  busy,
  onDraftChange,
  onClose,
  onConfirm,
}: {
  draft: CopyGlobalDraft;
  categories: CanvasTemplateCategory[];
  busy: boolean;
  onDraftChange: (draft: CopyGlobalDraft) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();

  return (
    <ModalShell
      onClose={onClose}
      closeDisabled={busy}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      overlayClassName="z-[90] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      panelClassName="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45"
    >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-950 dark:text-white">
              {t("templateManage.copyGlobalTitle")}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t("templateManage.copyGlobalDescription")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={TEMPLATE_ICON_ACTION_CLASS}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <SelectField
            value={draft.category_id}
            options={[
              { value: "", label: t("templateManage.globalCategoryRequired") },
              ...categories.map((category) => ({ value: category.id, label: category.name })),
            ]}
            onChange={(category_id) => onDraftChange({ ...draft, category_id })}
            ariaLabel={t("templateManage.templateCategory")}
            radius="lg"
          />
          <input
            value={draft.title}
            onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
            className={TEMPLATE_INPUT_CLASS}
            placeholder={t("templateManage.templateTitle")}
          />
          <textarea
            value={draft.description}
            onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
            className={`${TEMPLATE_TEXTAREA_CLASS} min-h-20 resize-y`}
            placeholder={t("templateManage.templateDescription")}
          />
          <input
            type="number"
            value={draft.sort_order}
            onChange={(event) => onDraftChange({ ...draft, sort_order: event.target.value })}
            className={TEMPLATE_INPUT_CLASS}
            placeholder={t("templateManage.templateSort")}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={TEMPLATE_SECONDARY_ACTION_CLASS}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !draft.category_id}
            className={TEMPLATE_MAIN_ACTION_CLASS}
          >
            {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
            {t("templateManage.copyGlobal")}
          </button>
        </div>
    </ModalShell>
  );
}
