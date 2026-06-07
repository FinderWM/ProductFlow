import { useMemo, useState } from "react";
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
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { SelectField } from "../components/SelectField";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { localizeCanvasTemplateSummary } from "../lib/canvasTemplateLocalization";
import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
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
  return error instanceof ApiError ? error.detail : fallback;
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

export function TemplateManagementPage({ mode }: TemplateManagementPageProps) {
  const { locale, t } = useI18n();
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

  return (
    <div className="pf-app min-h-[100dvh] text-slate-900 dark:text-slate-100">
      <TopNav breadcrumbs={pageTitle} />
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between">
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
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-[#0f1726] dark:text-slate-200 dark:hover:border-violet-400/55 dark:hover:text-violet-100"
          >
            <ArrowLeft size={15} className="mr-2" />
            {backLabel}
          </button>
        </div>

        {savedMessage ? (
          <div className="mb-4 flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200">
            <CheckCircle2 size={16} className="mr-2" />
            {savedMessage}
          </div>
        ) : null}
        {error || loadFailed ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
            {error || t("templateManage.loadFailed")}
          </div>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25">
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
                      className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400 dark:focus:ring-violet-400/20"
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

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("templateManage.categoryPanel")}</h2>
                <button
                  type="button"
                  onClick={() => {
                    setCategoryEditor(categoryDraft());
                    setCategoryEditorOpen(true);
                  }}
                  className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-indigo-500 dark:bg-violet-500 dark:hover:bg-violet-400"
                >
                  <Plus size={13} className="mr-1.5" />
                  {t("templateManage.categoryCreate")}
                </button>
              </div>
              {categoryEditorOpen ? (
                <form
                  className="mt-4 grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/45 p-3 dark:border-violet-400/30 dark:bg-violet-500/10"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveCategoryMutation.mutate();
                  }}
                >
                  <input
                    value={categoryEditor.name}
                    onChange={(event) => setCategoryEditor((current) => ({ ...current, name: event.target.value }))}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:focus:border-violet-400"
                    placeholder={t("templateManage.categoryName")}
                    maxLength={120}
                  />
                  <input
                    type="number"
                    value={categoryEditor.sort_order}
                    onChange={(event) => setCategoryEditor((current) => ({ ...current, sort_order: event.target.value }))}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:focus:border-violet-400"
                    placeholder={t("templateManage.categorySort")}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setCategoryEditorOpen(false)}
                      className="h-9 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-white/10"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={saveCategoryMutation.isPending}
                      className="inline-flex h-9 items-center rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-60 dark:bg-violet-500"
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
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-[#0b1220]"
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
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-indigo-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-violet-100"
                        aria-label={t("templateManage.categorySave")}
                        title={t("templateManage.categorySave")}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete({ kind: "category", id: category.id, name: category.name })}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-200"
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

          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25">
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
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60 shadow-sm dark:border-slate-700 dark:bg-[#0b1220]"
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
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400"
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
                          className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400"
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
                            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400"
                            placeholder={t("templateManage.templateSort")}
                          />
                        </div>
                        {canManageAvailability ? (
                          <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-[#111b2d]">
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
                                className="min-h-16 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:focus:border-violet-400"
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
                            className="min-h-16 w-full resize-y rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950 outline-none focus:border-amber-400 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100"
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
                              className="inline-flex h-9 items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100"
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
                                className="inline-flex h-9 items-center rounded-lg border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-400/35 dark:bg-[#111b2d] dark:text-amber-100 dark:hover:bg-amber-500/10"
                              >
                                {t("templateManage.reviewReject")}
                              </button>
                              <button
                                type="button"
                                disabled={reviewTemplateMutation.isPending || !templateId}
                                onClick={() => reviewTemplateMutation.mutate({ template, approved: true })}
                                className="inline-flex h-9 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-100"
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
                              className="inline-flex h-9 items-center rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
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
                                  className="inline-flex h-9 items-center rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-400/35 dark:bg-[#111b2d] dark:text-red-200 dark:hover:bg-red-500/10"
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
                                className="inline-flex h-9 items-center rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
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
      </main>

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
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("templateManage.copyGlobalTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{t("templateManage.copyGlobalDescription")}</p>
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
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400"
            placeholder={t("templateManage.templateTitle")}
          />
          <textarea
            value={draft.description}
            onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
            className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400"
            placeholder={t("templateManage.templateDescription")}
          />
          <input
            type="number"
            value={draft.sort_order}
            onChange={(event) => onDraftChange({ ...draft, sort_order: event.target.value })}
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400"
            placeholder={t("templateManage.templateSort")}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !draft.category_id}
            className="inline-flex h-9 items-center rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
            {t("templateManage.copyGlobal")}
          </button>
        </div>
      </div>
    </div>
  );
}
