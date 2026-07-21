import { useEffect, useId, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "vaul";
import {
  ArrowLeft,
  CheckCircle2,
  CopyPlus,
  Layers3,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  ClassicCheckbox,
  ClassicSelectField,
  ClassicTextarea,
  ClassicTextInput,
} from "../components/classicInputs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  actionButtonComponentForAppearance,
  type LayoutActionAppearance,
} from "../components/layoutActionButtons";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../components/loading/AsyncContent";
import { Skeleton, SkeletonCards, SkeletonRows, SkeletonText } from "../components/loading/Skeleton";
import { ModalShell } from "../components/ModalShell";
import { TopNav } from "../components/TopNav";
import {
  WorkspaceCheckbox,
  WorkspaceSelectField,
  WorkspaceTextarea,
  WorkspaceTextInput,
} from "../components/workspaceInputs";
import { api, ApiError } from "../lib/api";
import {
  asyncViewPhase,
  asyncViewStateFromQuery,
  combineAsyncViewStates,
  type AsyncViewState,
} from "../lib/asyncViewState";
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
import { settingsPathForSection } from "./settings/sections";
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

const TEMPLATE_PANEL_CLASS =
  "pf-settings-bordered-module rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 " +
  "dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25";
const TEMPLATE_FIELD_CARD_CLASS =
  "pf-settings-field-card rounded-xl border border-slate-200 bg-slate-50/70 shadow-none dark:border-slate-700 dark:bg-[#0b1220]";
const TEMPLATE_FEEDBACK_AUTO_DISMISS_MS = 1000;
export const TEMPLATE_MANAGE_MOBILE_CATEGORY_DRAWER_DESKTOP_QUERY = "(min-width: 1024px)";

export function shouldUseDesktopTemplateCategoryRail(
  mediaMatches: (query: string) => boolean = (query) =>
    typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches),
): boolean {
  return mediaMatches(TEMPLATE_MANAGE_MOBILE_CATEGORY_DRAWER_DESKTOP_QUERY);
}
const TEMPLATE_ENTRY_SORT_ORDER: Record<CanvasTemplateEntryMode, number> = {
  image: 0,
  copy: 1,
  tail: 2,
};
const TEMPLATE_SCOPE_SORT_ORDER: Record<CanvasTemplateScope, number> = {
  global: 0,
  user: 1,
};

interface TemplateManagementTemplateQueryInput {
  scope: CanvasTemplateScope;
  search?: string;
  category_id?: string;
  initial_workflow_entry?: CanvasTemplateEntryMode;
}

function templateActionAppearance(workspaceSubpage: boolean): LayoutActionAppearance {
  return workspaceSubpage ? "workspace" : "classic";
}

function templateActionButtonComponent(workspaceSubpage: boolean) {
  return actionButtonComponentForAppearance(templateActionAppearance(workspaceSubpage));
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

export function templateManagementInitialWorkflowEntry(
  entryFilter: EntryFilter,
): CanvasTemplateEntryMode | undefined {
  return entryFilter === "all" ? undefined : entryFilter;
}

export function templateManagementTemplateQueryInputs({
  mode,
  search,
  categoryFilter,
  entryFilter,
}: {
  mode: TemplateManagementMode;
  search: string;
  categoryFilter: string;
  entryFilter: EntryFilter;
}): TemplateManagementTemplateQueryInput[] {
  const normalizedSearch = search.trim() || undefined;
  const initial_workflow_entry = templateManagementInitialWorkflowEntry(entryFilter);

  if (mode === "personal") {
    return [
      {
        scope: "user",
        search: normalizedSearch,
        category_id: categoryFilter || undefined,
        initial_workflow_entry,
      },
    ];
  }

  return [
    {
      scope: "global",
      search: normalizedSearch,
      category_id: categoryFilter || undefined,
      initial_workflow_entry,
    },
    {
      scope: "user",
      search: normalizedSearch,
      initial_workflow_entry,
    },
  ];
}

export function sortTemplateManagementTemplates(templates: CanvasTemplateSummary[]): CanvasTemplateSummary[] {
  return [...templates].sort((left, right) => {
    const entryOrder = TEMPLATE_ENTRY_SORT_ORDER[left.entry_mode] - TEMPLATE_ENTRY_SORT_ORDER[right.entry_mode];
    if (entryOrder !== 0) {
      return entryOrder;
    }
    const leftScope = left.scope ?? "user";
    const rightScope = right.scope ?? "user";
    const scopeOrder = TEMPLATE_SCOPE_SORT_ORDER[leftScope] - TEMPLATE_SCOPE_SORT_ORDER[rightScope];
    if (scopeOrder !== 0) {
      return scopeOrder;
    }
    const sortOrder = (left.sort_order ?? 100) - (right.sort_order ?? 100);
    if (sortOrder !== 0) {
      return sortOrder;
    }
    const titleOrder = left.title.localeCompare(right.title, "zh-Hans-CN");
    if (titleOrder !== 0) {
      return titleOrder;
    }
    return left.key.localeCompare(right.key, "zh-Hans-CN");
  });
}

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

function TemplateFilterStrip({
  search,
  entryFilter,
  categoryFilter,
  categories,
  categoriesResolved,
  isWorkspaceSubpage,
  onSearchChange,
  onEntryFilterChange,
  onCategoryFilterChange,
}: {
  search: string;
  entryFilter: EntryFilter;
  categoryFilter: string;
  categories: CanvasTemplateCategory[];
  categoriesResolved: boolean;
  isWorkspaceSubpage: boolean;
  onSearchChange: (value: string) => void;
  onEntryFilterChange: (value: EntryFilter) => void;
  onCategoryFilterChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className={TEMPLATE_PANEL_CLASS}>
      <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("templateFilter.search")}</h2>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t("templateFilter.search")}
          </span>
          <span className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            {isWorkspaceSubpage ? (
              <WorkspaceTextInput
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                className="pl-9"
                placeholder={t("templateFilter.searchPlaceholder")}
              />
            ) : (
              <ClassicTextInput
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                className="pl-9"
                placeholder={t("templateFilter.searchPlaceholder")}
              />
            )}
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("templateManage.entry")}
            </span>
            {isWorkspaceSubpage ? (
              <WorkspaceSelectField
                value={entryFilter}
                options={ENTRY_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                onChange={(value) => onEntryFilterChange(value as EntryFilter)}
                size="default"
              />
            ) : (
              <ClassicSelectField
                value={entryFilter}
                options={ENTRY_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                onChange={(value) => onEntryFilterChange(value as EntryFilter)}
                radius="lg"
              />
            )}
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("templateFilter.category")}
            </span>
            {isWorkspaceSubpage ? (
              <WorkspaceSelectField
                value={categoryFilter}
                options={[
                  { value: "", label: t("templateFilter.allCategories") },
                  ...categories.map((category) => ({ value: category.id, label: category.name })),
                ]}
                onChange={onCategoryFilterChange}
                size="default"
                disabled={!categoriesResolved}
              />
            ) : (
              <ClassicSelectField
                value={categoryFilter}
                options={[
                  { value: "", label: t("templateFilter.allCategories") },
                  ...categories.map((category) => ({ value: category.id, label: category.name })),
                ]}
                onChange={onCategoryFilterChange}
                radius="lg"
                disabled={!categoriesResolved}
              />
            )}
          </label>
        </div>
      </div>
    </section>
  );
}

function templateCategoryNavButtonClassName(active: boolean, extraClassName = "") {
  return `pf-resource-library-group-nav-item flex min-h-10 w-full items-center px-3 py-2 text-left text-sm ${
    active ? "font-semibold text-slate-950 dark:text-white" : "text-slate-500 dark:text-slate-400"
  } ${extraClassName}`.trim();
}

function TemplateCategoryPanel({
  categories,
  categoriesState,
  categoriesResolved,
  categoryFilter,
  categoryEditorOpen,
  categoryEditor,
  saveCategoryPending,
  isWorkspaceSubpage,
  surfaceClassName,
  compactHeader = false,
  onCategoryFilterChange,
  onCategoryEditorChange,
  onCategoryEditorOpenChange,
  onSaveCategory,
  onDeleteCategory,
  onRetryCategories,
}: {
  categories: CanvasTemplateCategory[];
  categoriesState: AsyncViewState;
  categoriesResolved: boolean;
  categoryFilter: string;
  categoryEditorOpen: boolean;
  categoryEditor: CategoryDraft;
  saveCategoryPending: boolean;
  isWorkspaceSubpage: boolean;
  surfaceClassName?: string;
  compactHeader?: boolean;
  onCategoryFilterChange: (categoryId: string) => void;
  onCategoryEditorChange: (draft: CategoryDraft) => void;
  onCategoryEditorOpenChange: (open: boolean) => void;
  onSaveCategory: () => void;
  onDeleteCategory: (category: CanvasTemplateCategory) => void;
  onRetryCategories: () => void;
}) {
  const { t } = useI18n();
  const PageActionButton = templateActionButtonComponent(isWorkspaceSubpage);
  const selectedCategory = categories.find((category) => category.id === categoryFilter) ?? null;
  const categoryActionsClassName =
    "absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 " +
    (compactHeader
      ? ""
      : "pointer-events-none opacity-0 transition-opacity duration-150 " +
        "group-hover/template-category-row:pointer-events-auto group-hover/template-category-row:opacity-100 " +
        "group-focus-within/template-category-row:pointer-events-auto group-focus-within/template-category-row:opacity-100");

  return (
    <section className={surfaceClassName ?? TEMPLATE_PANEL_CLASS}>
      <div className={`flex items-center gap-3 ${compactHeader ? "justify-end" : "justify-between"}`}>
        {compactHeader ? null : (
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("templateManage.categoryPanel")}</h2>
            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
              {(selectedCategory ? selectedCategory.name : t("templateFilter.allCategories")) +
                " · " +
                t("templateManage.categoryCount", { count: categories.length })}
            </p>
          </div>
        )}
        <PageActionButton
          onClick={() => {
            onCategoryEditorChange(categoryDraft());
            onCategoryEditorOpenChange(true);
          }}
          preset="primary"
          size="md"
          disabled={!categoriesResolved}
          leadingIcon={<Plus size={13} />}
          fullWidth={compactHeader}
        >
          {t("templateManage.categoryCreate")}
        </PageActionButton>
      </div>
      {categoryEditorOpen ? (
        <form
          className={`${TEMPLATE_FIELD_CARD_CLASS} mt-4 grid gap-3 p-3`}
          onSubmit={(event) => {
            event.preventDefault();
            onSaveCategory();
          }}
        >
          {isWorkspaceSubpage ? (
            <>
              <WorkspaceTextInput
                value={categoryEditor.name}
                onChange={(event) => onCategoryEditorChange({ ...categoryEditor, name: event.target.value })}
                size="default"
                placeholder={t("templateManage.categoryName")}
                maxLength={120}
              />
              <WorkspaceTextInput
                type="number"
                value={categoryEditor.sort_order}
                onChange={(event) => onCategoryEditorChange({ ...categoryEditor, sort_order: event.target.value })}
                size="default"
                placeholder={t("templateManage.categorySort")}
              />
            </>
          ) : (
            <>
              <ClassicTextInput
                value={categoryEditor.name}
                onChange={(event) => onCategoryEditorChange({ ...categoryEditor, name: event.target.value })}
                placeholder={t("templateManage.categoryName")}
                maxLength={120}
              />
              <ClassicTextInput
                type="number"
                value={categoryEditor.sort_order}
                onChange={(event) => onCategoryEditorChange({ ...categoryEditor, sort_order: event.target.value })}
                placeholder={t("templateManage.categorySort")}
              />
            </>
          )}
          <div className="flex justify-end gap-2">
            <PageActionButton onClick={() => onCategoryEditorOpenChange(false)} preset="secondary" size="sm">
              {t("common.cancel")}
            </PageActionButton>
            <PageActionButton
              type="submit"
              disabled={saveCategoryPending || !categoryEditor.name.trim()}
              preset="primary"
              size="md"
              loading={saveCategoryPending}
            >
              {t("templateManage.categorySave")}
            </PageActionButton>
          </div>
        </form>
      ) : null}
      <AsyncContent
        state={categoriesState}
        refreshIntent="background"
        loadingLabel={t("app.loading")}
        skeleton={<SkeletonRows count={4} className="mt-4" />}
        initialError={(
          <AsyncErrorState
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100"
            title={t("templateFilter.categoriesLoadFailed")}
            retryLabel={t("common.retry")}
            retryingLabel={t("app.loading")}
            retrying={categoriesState.fetch === "fetching"}
            onRetry={onRetryCategories}
          />
        )}
        paused={(
          <AsyncPausedState
            title={t("app.requestPaused.title")}
            message={t("app.requestPaused.message")}
            retryLabel={t("common.retry")}
            onRetry={onRetryCategories}
            className="mt-4 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100"
          />
        )}
        inactive={null}
        empty={(
          <div className="mt-4 rounded-xl border border-dashed pf-hairline-strong px-3 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t("templateManage.categoryEmpty")}
          </div>
        )}
        refreshFeedback={
          categoriesState.error === "refresh" ? (
            <div className="mt-3 text-xs text-red-600 dark:text-red-300">
              {t("templateFilter.categoriesLoadFailed")}
            </div>
          ) : null
        }
      >
        <nav className="mt-4 space-y-1" aria-label={t("templateManage.categoryPanel")}>
          <button
            type="button"
            onClick={() => onCategoryFilterChange("")}
            aria-current={!categoryFilter ? "page" : undefined}
            className={templateCategoryNavButtonClassName(!categoryFilter)}
          >
            <span className="min-w-0 whitespace-normal break-words leading-5">{t("templateFilter.allCategories")}</span>
          </button>
          {categories.map((category) => {
            const selected = categoryFilter === category.id;
            return (
              <div key={category.id} className="group/template-category-row relative flex min-h-10 items-center py-1">
                <button
                  type="button"
                  onClick={() => onCategoryFilterChange(category.id)}
                  aria-current={selected ? "page" : undefined}
                  className={templateCategoryNavButtonClassName(selected, "min-w-0 flex-1 pr-16")}
                >
                  <span className="block min-w-0">
                    <span className="block min-w-0 whitespace-normal break-words leading-5">{category.name}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">{category.sort_order}</span>
                  </span>
                </button>
                <div className={categoryActionsClassName}>
                  <PageActionButton
                    type="button"
                    onClick={() => {
                      onCategoryEditorChange(categoryDraft(category));
                      onCategoryEditorOpenChange(true);
                    }}
                    preset="secondary"
                    size="icon-sm"
                    aria-label={t("common.rename")}
                    title={t("common.rename")}
                    leadingIcon={<Pencil size={13} />}
                  />
                  <PageActionButton
                    type="button"
                    onClick={() => onDeleteCategory(category)}
                    preset="danger"
                    size="icon-sm"
                    aria-label={t("templateManage.categoryDelete")}
                    title={t("templateManage.categoryDelete")}
                    leadingIcon={<Trash2 size={13} />}
                  />
                </div>
              </div>
            );
          })}
        </nav>
      </AsyncContent>
    </section>
  );
}

function TemplateManagementFeedbackDialog({
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
  const PageActionButton = templateActionButtonComponent(workspaceSubpage);
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
            <PageActionButton
              type="button"
              onClick={onCloseError}
              preset="secondary"
              size="icon-sm"
              aria-label={t("common.close")}
              title={t("common.close")}
              leadingIcon={<X size={16} />}
            />
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
  const mobileCategoryDrawerButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileCategoryDrawerRestoreFocusRef = useRef(true);
  const [search, setSearch] = useState("");
  const [entryFilter, setEntryFilter] = useState<EntryFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [categoryEditor, setCategoryEditor] = useState<CategoryDraft>(() => categoryDraft());
  const [mobileCategoryDrawerOpen, setMobileCategoryDrawerOpen] = useState(false);
  const [useFloatingCategoryRail, setUseFloatingCategoryRail] = useState(
    () => !shouldUseDesktopTemplateCategoryRail(),
  );
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, TemplateDraft>>({});
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [copyGlobalDraft, setCopyGlobalDraft] = useState<CopyGlobalDraft | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");
  const normalizedSearch = search.trim();
  const templateQueryInputs = templateManagementTemplateQueryInputs({
    mode,
    search,
    categoryFilter,
    entryFilter,
  });
  const personalTemplateQueryInput = templateQueryInputs[0] ?? { scope: "user" as const };
  const globalTemplateQueryInput = templateQueryInputs[0] ?? { scope: "global" as const };
  const userTemplateQueryInput = templateQueryInputs[1] ?? { scope: "user" as const };

  const personalTemplatesQuery = useQuery({
    queryKey: ["canvas-templates", "manage", "personal", normalizedSearch, categoryFilter, entryFilter],
    queryFn: () => api.listManageCanvasTemplates(personalTemplateQueryInput),
    enabled: mode === "personal",
    placeholderData: keepPreviousData,
  });
  const globalTemplatesQuery = useQuery({
    queryKey: ["canvas-templates", "manage", "global", normalizedSearch, categoryFilter, entryFilter],
    queryFn: () => api.listManageCanvasTemplates(globalTemplateQueryInput),
    enabled: mode === "global",
    placeholderData: keepPreviousData,
  });
  const userTemplatesQuery = useQuery({
    queryKey: ["canvas-templates", "manage", "global-copy-sources", normalizedSearch, entryFilter],
    queryFn: () => api.listManageCanvasTemplates(userTemplateQueryInput),
    enabled: mode === "global",
    placeholderData: keepPreviousData,
  });
  const categoriesQuery = useQuery({
    queryKey: ["canvas-template-categories", "manage", scope],
    queryFn: () => api.listManageCanvasTemplateCategories({ scope }),
    placeholderData: keepPreviousData,
  });
  const personalTemplatesState = asyncViewStateFromQuery({
    active: mode === "personal",
    data: personalTemplatesQuery.data,
    dataUpdatedAt: personalTemplatesQuery.dataUpdatedAt,
    isSuccess: personalTemplatesQuery.isSuccess,
    isError: personalTemplatesQuery.isError,
    fetchStatus: personalTemplatesQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const globalTemplatesState = asyncViewStateFromQuery({
    active: mode === "global",
    data: globalTemplatesQuery.data,
    dataUpdatedAt: globalTemplatesQuery.dataUpdatedAt,
    isSuccess: globalTemplatesQuery.isSuccess,
    isError: globalTemplatesQuery.isError,
    fetchStatus: globalTemplatesQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const userTemplatesState = asyncViewStateFromQuery({
    active: mode === "global",
    data: userTemplatesQuery.data,
    dataUpdatedAt: userTemplatesQuery.dataUpdatedAt,
    isSuccess: userTemplatesQuery.isSuccess,
    isError: userTemplatesQuery.isError,
    fetchStatus: userTemplatesQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const categoriesState = asyncViewStateFromQuery({
    active: true,
    data: categoriesQuery.data,
    dataUpdatedAt: categoriesQuery.dataUpdatedAt,
    isSuccess: categoriesQuery.isSuccess,
    isError: categoriesQuery.isError,
    fetchStatus: categoriesQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const categoriesPhase = asyncViewPhase(categoriesState);

  const categories = categoriesQuery.data?.items ?? [];
  const globalCategories = mode === "global" ? categories : [];
  const templateItems =
    mode === "global"
      ? sortTemplateManagementTemplates([
          ...(globalTemplatesQuery.data?.items ?? []),
          ...(userTemplatesQuery.data?.items ?? []),
        ])
      : sortTemplateManagementTemplates(personalTemplatesQuery.data?.items ?? []);
  const templates = useMemo(
    () =>
      templateItems
        .filter((template) => template.kind === "full_canvas")
        .map((template) => localizeCanvasTemplateSummary(template, locale)),
    [locale, templateItems],
  );
  const templatesState = combineAsyncViewStates({
    active: true,
    critical: mode === "global" ? [globalTemplatesState, userTemplatesState] : [personalTemplatesState],
    isEmpty: templates.length === 0,
  });

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
  const backPath = mode === "global" ? settingsPathForSection("globalTemplates") : "/inspirations/new";
  const backLabel = mode === "global" ? t("templateManage.backToSettings") : t("templateManage.backToCreate");
  const categoriesResolved = categoriesPhase === "ready" || categoriesPhase === "empty";
  const isWorkspaceSubpage = activeScheme === "workspace";
  const PageActionButton = templateActionButtonComponent(isWorkspaceSubpage);
  const selectedCategory = categories.find((category) => category.id === categoryFilter) ?? null;
  const floatingCategoryTriggerLabel = `${t("templateManage.categoryPanel")} · ${
    selectedCategory ? selectedCategory.name : t("templateFilter.allCategories")
  } · ${t("templateManage.categoryCount", { count: categories.length })}`;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const mediaQuery = window.matchMedia(TEMPLATE_MANAGE_MOBILE_CATEGORY_DRAWER_DESKTOP_QUERY);
    const handleViewportChange = (event?: MediaQueryListEvent) => {
      const useDesktopRail = event?.matches ?? mediaQuery.matches;
      setUseFloatingCategoryRail(!useDesktopRail);
      if (useDesktopRail) {
        setMobileCategoryDrawerOpen(false);
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

  function focusMobileCategoryDrawerTrigger() {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      mobileCategoryDrawerButtonRef.current?.focus();
    });
  }

  function handleSelectCategory(categoryId: string) {
    setCategoryFilter(categoryId);
    if (useFloatingCategoryRail) {
      setMobileCategoryDrawerOpen(false);
    }
  }

  function retryTemplates() {
    if (mode === "global") {
      void Promise.all([globalTemplatesQuery.refetch(), userTemplatesQuery.refetch()]);
      return;
    }
    void personalTemplatesQuery.refetch();
  }

  const categoryPanel = (
    <TemplateCategoryPanel
      categories={categories}
      categoriesState={categoriesState}
      categoriesResolved={categoriesResolved}
      categoryFilter={categoryFilter}
      categoryEditorOpen={categoryEditorOpen}
      categoryEditor={categoryEditor}
      saveCategoryPending={saveCategoryMutation.isPending}
      isWorkspaceSubpage={isWorkspaceSubpage}
      surfaceClassName={useFloatingCategoryRail ? "space-y-0" : undefined}
      compactHeader={useFloatingCategoryRail}
      onCategoryFilterChange={handleSelectCategory}
      onCategoryEditorChange={setCategoryEditor}
      onCategoryEditorOpenChange={setCategoryEditorOpen}
      onSaveCategory={() => saveCategoryMutation.mutate()}
      onDeleteCategory={(category) => setPendingDelete({ kind: "category", id: category.id, name: category.name })}
      onRetryCategories={() => void categoriesQuery.refetch()}
    />
  );

  const filterStrip = (
    <TemplateFilterStrip
      search={search}
      entryFilter={entryFilter}
      categoryFilter={categoryFilter}
      categories={categories}
      categoriesResolved={categoriesResolved}
      isWorkspaceSubpage={isWorkspaceSubpage}
      onSearchChange={setSearch}
      onEntryFilterChange={setEntryFilter}
      onCategoryFilterChange={setCategoryFilter}
    />
  );

  return (
    <div className={`${isWorkspaceSubpage ? "pf-workspace pf-settings-workspace" : "pf-app"} min-h-[100dvh] text-slate-900 dark:text-slate-100`}>
      <TopNav breadcrumbs={pageTitle} />
      <main className={isWorkspaceSubpage ? "pf-workspace-subpage flex-1" : "pf-page pf-page-wide"}>
        <div className={isWorkspaceSubpage ? "pf-workspace-subpage-frame-shell w-full" : "contents"}>
          <div className={isWorkspaceSubpage ? "pf-workspace-subpage-frame" : "contents"}>
        <header className={isWorkspaceSubpage ? "pf-workspace-subpage-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between" : "pf-page-header border-b border-slate-200 pb-5 dark:border-slate-800"}>
          <div>
            <div className="pf-eyebrow mb-2">
              <Layers3 size={13} className="mr-1.5" />
              {mode === "global" ? t("nav.globalTemplates") : t("nav.templates")}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{pageTitle}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{pageDescription}</p>
          </div>
          <PageActionButton
            onClick={() => navigate(backPath)}
            preset="secondary"
            size="md"
            leadingIcon={<ArrowLeft size={15} />}
          >
            {backLabel}
          </PageActionButton>
        </header>

        {useFloatingCategoryRail ? (
          <button
            ref={mobileCategoryDrawerButtonRef}
            type="button"
            onClick={() => setMobileCategoryDrawerOpen(true)}
            className="pf-resource-library-mobile-groups-trigger"
            aria-label={floatingCategoryTriggerLabel}
            title={floatingCategoryTriggerLabel}
          >
            <span className="pf-resource-library-mobile-groups-mark" aria-hidden="true">
              <Layers3 size={18} />
              {categories.length ? (
                <span className="pf-resource-library-mobile-groups-count">{Math.min(categories.length, 99)}</span>
              ) : null}
            </span>
            <span className="text-center text-[11px] font-semibold leading-4">{t("templateManage.categoryPanel")}</span>
          </button>
        ) : null}

        <div
          className={
            useFloatingCategoryRail
              ? isWorkspaceSubpage
                ? "pf-side-shell min-h-full"
                : "space-y-5"
              : isWorkspaceSubpage
                ? "pf-side-shell min-h-full"
                : "grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]"
          }
        >
          {!useFloatingCategoryRail ? (
            <aside className={isWorkspaceSubpage ? "pf-side-rail space-y-5 px-4 py-5 sm:px-5" : "space-y-5 lg:sticky lg:top-4 lg:self-start"}>
              {filterStrip}
              {categoryPanel}
            </aside>
          ) : null}

          <section
            className={
              useFloatingCategoryRail
                ? isWorkspaceSubpage
                  ? "pf-side-content min-w-0 space-y-5 px-4 py-5 sm:px-6 lg:px-8"
                  : "min-w-0 space-y-5"
                : isWorkspaceSubpage
                  ? "pf-side-content min-w-0 px-4 py-5 sm:px-6 lg:px-8"
                  : "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25"
            }
          >
            {useFloatingCategoryRail ? filterStrip : null}
            <div className={useFloatingCategoryRail ? (isWorkspaceSubpage ? "min-w-0" : "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25") : "contents"}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("templateManage.templatePanel")}</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("templateFilter.scope")}: {mode === "global" ? t("templateFilter.scopeGlobal") : t("templateFilter.scopeUser")}
                </p>
              </div>
            </div>

            <AsyncContent
              state={templatesState}
              refreshIntent="parameter-change"
              loadingLabel={t("app.loading")}
              skeleton={
                isWorkspaceSubpage ? (
                  <SkeletonCards count={6} className="lg:grid-cols-2 xl:grid-cols-2" />
                ) : (
                  <div
                    aria-hidden="true"
                    className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
                  >
                    {Array.from({ length: 6 }, (_, index) => (
                      <article
                        key={index}
                        className="overflow-hidden rounded-xl border pf-hairline pf-surface"
                      >
                        <Skeleton className="aspect-[4/3] w-full rounded-none" />
                        <div className="space-y-3 p-4">
                          <Skeleton className="h-4 w-3/5" />
                          <SkeletonText lines={2} />
                        </div>
                      </article>
                    ))}
                  </div>
                )
              }
              initialError={(
                <AsyncErrorState
                  title={t("templateManage.loadFailed")}
                  retryLabel={t("common.retry")}
                  retryingLabel={t("app.loading")}
                  retrying={templatesState.fetch === "fetching"}
                  onRetry={retryTemplates}
                />
              )}
              paused={(
                <AsyncPausedState
                  title={t("app.requestPaused.title")}
                  message={t("app.requestPaused.message")}
                  retryLabel={t("common.retry")}
                  onRetry={retryTemplates}
                />
              )}
              inactive={null}
              empty={(
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed pf-hairline-strong bg-slate-50 px-6 text-center dark:border-slate-700 dark:bg-[#0b1220]">
                  <Layers3 size={34} className="text-slate-400" />
                  <div className="mt-4 text-sm font-semibold text-slate-900 dark:text-white">{t("templateManage.templateEmpty")}</div>
                </div>
              )}
              refreshFeedback={
                templatesState.error === "refresh" ? (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                    <span>{t("templateManage.loadFailed")}</span>
                    <PageActionButton
                      preset="secondary"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={retryTemplates}
                    >
                      {t("common.retry")}
                    </PageActionButton>
                  </div>
                ) : null
              }
            >
              <div
                className={
                  isWorkspaceSubpage
                    ? "grid gap-4 lg:grid-cols-2"
                    : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"
                }
              >
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
                        {isWorkspaceSubpage ? (
                          <WorkspaceTextInput
                            value={draft.title}
                            onChange={(event) =>
                              setTemplateDrafts((current) => ({
                                ...current,
                                [template.key]: { ...draft, title: event.target.value },
                              }))
                            }
                            readOnly={!canEditTemplate}
                            className="font-semibold"
                            placeholder={t("templateManage.templateTitle")}
                            maxLength={255}
                          />
                        ) : (
                          <ClassicTextInput
                            value={draft.title}
                            onChange={(event) =>
                              setTemplateDrafts((current) => ({
                                ...current,
                                [template.key]: { ...draft, title: event.target.value },
                              }))
                            }
                            readOnly={!canEditTemplate}
                            className="font-semibold"
                            placeholder={t("templateManage.templateTitle")}
                            maxLength={255}
                          />
                        )}
                        {isWorkspaceSubpage ? (
                          <WorkspaceTextarea
                            value={draft.description}
                            onChange={(event) =>
                              setTemplateDrafts((current) => ({
                                ...current,
                                [template.key]: { ...draft, description: event.target.value },
                              }))
                            }
                            readOnly={!canEditTemplate}
                            className="min-h-20 resize-y"
                            placeholder={t("templateManage.templateDescription")}
                            maxLength={1000}
                          />
                        ) : (
                          <ClassicTextarea
                            value={draft.description}
                            onChange={(event) =>
                              setTemplateDrafts((current) => ({
                                ...current,
                                [template.key]: { ...draft, description: event.target.value },
                              }))
                            }
                            readOnly={!canEditTemplate}
                            className="min-h-20"
                            placeholder={t("templateManage.templateDescription")}
                            maxLength={1000}
                          />
                        )}
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                          {isWorkspaceSubpage ? (
                            <WorkspaceSelectField
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
                              size="compact"
                              disabled={!canEditTemplate || !categoriesResolved}
                            />
                          ) : (
                            <ClassicSelectField
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
                              size="compact"
                              disabled={!canEditTemplate || !categoriesResolved}
                            />
                          )}
                          {isWorkspaceSubpage ? (
                            <WorkspaceTextInput
                              type="number"
                              value={draft.sort_order}
                              onChange={(event) =>
                                setTemplateDrafts((current) => ({
                                  ...current,
                                  [template.key]: { ...draft, sort_order: event.target.value },
                                }))
                              }
                              readOnly={!canEditTemplate}
                              size="compact"
                              className="h-9"
                              placeholder={t("templateManage.templateSort")}
                            />
                          ) : (
                            <ClassicTextInput
                              type="number"
                              value={draft.sort_order}
                              onChange={(event) =>
                                setTemplateDrafts((current) => ({
                                  ...current,
                                  [template.key]: { ...draft, sort_order: event.target.value },
                                }))
                              }
                              readOnly={!canEditTemplate}
                              size="compact"
                              placeholder={t("templateManage.templateSort")}
                            />
                          )}
                        </div>
                        {canManageAvailability ? (
                          <div className={`${TEMPLATE_FIELD_CARD_CLASS} space-y-2 px-3 py-2`}>
                            {isWorkspaceSubpage ? (
                              <WorkspaceCheckbox
                                checked={draft.enabled}
                                onChange={(event) =>
                                  setTemplateDrafts((current) => ({
                                    ...current,
                                    [template.key]: { ...draft, enabled: event.target.checked },
                                  }))
                                }
                                wrapperClassName="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
                              >
                                {t("templateManage.templateEnabled")}
                              </WorkspaceCheckbox>
                            ) : (
                              <ClassicCheckbox
                                checked={draft.enabled}
                                onChange={(event) =>
                                  setTemplateDrafts((current) => ({
                                    ...current,
                                    [template.key]: { ...draft, enabled: event.target.checked },
                                  }))
                                }
                                wrapperClassName="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"
                              >
                                {t("templateManage.templateEnabled")}
                              </ClassicCheckbox>
                            )}
                            {!draft.enabled ? (
                              isWorkspaceSubpage ? (
                                <WorkspaceTextarea
                                  value={draft.disabled_reason}
                                  onChange={(event) =>
                                    setTemplateDrafts((current) => ({
                                      ...current,
                                      [template.key]: { ...draft, disabled_reason: event.target.value },
                                    }))
                                  }
                                  size="compact"
                                  className="min-h-16 resize-y text-xs leading-5"
                                  placeholder={t("templateManage.disabledReasonPlaceholder")}
                                  maxLength={1000}
                                />
                              ) : (
                                <ClassicTextarea
                                  value={draft.disabled_reason}
                                  onChange={(event) =>
                                    setTemplateDrafts((current) => ({
                                      ...current,
                                      [template.key]: { ...draft, disabled_reason: event.target.value },
                                    }))
                                  }
                                  size="compact"
                                  className="min-h-16 text-xs leading-5"
                                  placeholder={t("templateManage.disabledReasonPlaceholder")}
                                  maxLength={1000}
                                />
                              )
                            ) : null}
                          </div>
                        ) : null}
                        {requiresReviewNote ? (
                          isWorkspaceSubpage ? (
                            <WorkspaceTextarea
                              value={draft.review_note}
                              onChange={(event) =>
                                setTemplateDrafts((current) => ({
                                  ...current,
                                  [template.key]: { ...draft, review_note: event.target.value },
                                }))
                              }
                              size="compact"
                              className="min-h-16 resize-y border-amber-200 bg-amber-50 text-xs leading-5 text-amber-950 focus:border-amber-400 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100"
                              placeholder={t("templateManage.reviewNotePlaceholder")}
                              maxLength={1000}
                            />
                          ) : (
                            <ClassicTextarea
                              value={draft.review_note}
                              onChange={(event) =>
                                setTemplateDrafts((current) => ({
                                  ...current,
                                  [template.key]: { ...draft, review_note: event.target.value },
                                }))
                              }
                              size="compact"
                              className="min-h-16 border-amber-200 bg-amber-50 text-xs leading-5 text-amber-950 focus:border-amber-400 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100"
                              placeholder={t("templateManage.reviewNotePlaceholder")}
                              maxLength={1000}
                            />
                          )
                        ) : null}
                        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                          {mode === "global" && isUserTemplate ? (
                            <PageActionButton
                              onClick={() =>
                                setCopyGlobalDraft({
                                  template,
                                  category_id: globalCategories[0]?.id ?? "",
                                  title: template.title,
                                  description: template.description ?? "",
                                  sort_order: String(template.sort_order ?? 100),
                                })
                              }
                              preset="secondary"
                              size="md"
                              disabled={!categoriesResolved}
                              leadingIcon={<CopyPlus size={13} />}
                            >
                              {t("templateManage.copyGlobal")}
                            </PageActionButton>
                          ) : null}
                          {mode === "global" && isUserTemplate && template.review_status === "pending" ? (
                            <>
                              <PageActionButton
                                disabled={reviewTemplateMutation.isPending || !templateId}
                                onClick={() => reviewTemplateMutation.mutate({ template, approved: false })}
                                preset="secondary"
                                size="md"
                              >
                                {t("templateManage.reviewReject")}
                              </PageActionButton>
                              <PageActionButton
                                disabled={reviewTemplateMutation.isPending || !templateId}
                                onClick={() => reviewTemplateMutation.mutate({ template, approved: true })}
                                preset="primary"
                                size="md"
                              >
                                {t("templateManage.reviewApprove")}
                              </PageActionButton>
                            </>
                          ) : null}
                          {canManageAvailability && !canEditTemplate ? (
                            <PageActionButton
                              disabled={saveTemplateMutation.isPending || !templateId}
                              onClick={() => saveTemplateMutation.mutate({ template, draft })}
                              preset="primary"
                              size="md"
                              loading={saveTemplateMutation.isPending}
                              leadingIcon={<Save size={13} />}
                            >
                              {t("templateManage.templateSave")}
                            </PageActionButton>
                          ) : null}
                          {canEditTemplate ? (
                            <>
                              {mode === "personal" ? (
                                <PageActionButton
                                  onClick={() => setPendingDelete({ kind: "template", id: template.key, name: template.title })}
                                  preset="danger"
                                  size="md"
                                  leadingIcon={<Trash2 size={13} />}
                                >
                                  {t("templateManage.templateDelete")}
                                </PageActionButton>
                              ) : null}
                              <PageActionButton
                                disabled={
                                  saveTemplateMutation.isPending ||
                                  !draft.title.trim() ||
                                  !templateId ||
                                  (requiresReviewNote && !draft.review_note.trim())
                                }
                                onClick={() => saveTemplateMutation.mutate({ template, draft })}
                                preset="primary"
                                size="md"
                                loading={saveTemplateMutation.isPending}
                                leadingIcon={<Save size={13} />}
                              >
                                {t("templateManage.templateSave")}
                              </PageActionButton>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </AsyncContent>
            </div>
          </section>
        </div>
          </div>
        </div>
      </main>

      {useFloatingCategoryRail ? (
        <Drawer.Root
          direction="left"
          open={mobileCategoryDrawerOpen}
          onOpenChange={(open) => {
            setMobileCategoryDrawerOpen(open);
            if (!open) {
              const shouldRestoreFocus = mobileCategoryDrawerRestoreFocusRef.current;
              mobileCategoryDrawerRestoreFocusRef.current = true;
              if (shouldRestoreFocus) {
                focusMobileCategoryDrawerTrigger();
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
              <Drawer.Title className="sr-only">{t("templateManage.categoryPanel")}</Drawer.Title>
              <div className="pf-resource-library-mobile-groups-drawer-header px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="pf-resource-library-mobile-groups-mark shrink-0" aria-hidden="true">
                      <Layers3 size={18} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                        {t("templateManage.categoryPanel")}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        {(selectedCategory ? selectedCategory.name : t("templateFilter.allCategories")) +
                          " · " +
                          t("templateManage.categoryCount", { count: categories.length })}
                      </div>
                    </div>
                  </div>
                  <PageActionButton
                    type="button"
                    aria-label={t("common.close")}
                    title={t("common.close")}
                    onClick={() => setMobileCategoryDrawerOpen(false)}
                    preset="secondary"
                    size="icon-lg"
                    leadingIcon={<X size={18} />}
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                {categoryPanel}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      ) : null}

      <TemplateManagementFeedbackDialog
        successMessage={savedMessage}
        errorMessage={error}
        workspaceSubpage={isWorkspaceSubpage}
        onCloseSuccess={() => setSavedMessage("")}
        onCloseError={() => setError("")}
      />

      {copyGlobalDraft ? (
        <CopyGlobalDialog
          draft={copyGlobalDraft}
          categories={globalCategories}
          busy={copyToGlobalMutation.isPending}
          workspaceSubpage={isWorkspaceSubpage}
          onDraftChange={setCopyGlobalDraft}
          onClose={() => setCopyGlobalDraft(null)}
          onConfirm={() => copyToGlobalMutation.mutate()}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        appearance={templateActionAppearance(isWorkspaceSubpage)}
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
  workspaceSubpage = false,
  onDraftChange,
  onClose,
  onConfirm,
}: {
  draft: CopyGlobalDraft;
  categories: CanvasTemplateCategory[];
  busy: boolean;
  workspaceSubpage?: boolean;
  onDraftChange: (draft: CopyGlobalDraft) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const PageActionButton = templateActionButtonComponent(workspaceSubpage);

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
          <PageActionButton
            type="button"
            onClick={onClose}
            disabled={busy}
            preset="secondary"
            size="icon-sm"
            aria-label={t("common.close")}
            title={t("common.close")}
            leadingIcon={<X size={16} />}
          />
        </div>
        <div className="space-y-3 px-5 py-4">
          {workspaceSubpage ? (
            <WorkspaceSelectField
              value={draft.category_id}
              options={[
                { value: "", label: t("templateManage.globalCategoryRequired") },
                ...categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
              onChange={(category_id) => onDraftChange({ ...draft, category_id })}
              ariaLabel={t("templateManage.templateCategory")}
              size="default"
            />
          ) : (
            <ClassicSelectField
              value={draft.category_id}
              options={[
                { value: "", label: t("templateManage.globalCategoryRequired") },
                ...categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
              onChange={(category_id) => onDraftChange({ ...draft, category_id })}
              ariaLabel={t("templateManage.templateCategory")}
              radius="lg"
            />
          )}
          {workspaceSubpage ? (
            <WorkspaceTextInput
              value={draft.title}
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              size="default"
              placeholder={t("templateManage.templateTitle")}
            />
          ) : (
            <ClassicTextInput
              value={draft.title}
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              placeholder={t("templateManage.templateTitle")}
            />
          )}
          {workspaceSubpage ? (
            <WorkspaceTextarea
              value={draft.description}
              onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
              className="min-h-20 resize-y"
              placeholder={t("templateManage.templateDescription")}
            />
          ) : (
            <ClassicTextarea
              value={draft.description}
              onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
              className="min-h-20"
              placeholder={t("templateManage.templateDescription")}
            />
          )}
          {workspaceSubpage ? (
            <WorkspaceTextInput
              type="number"
              value={draft.sort_order}
              onChange={(event) => onDraftChange({ ...draft, sort_order: event.target.value })}
              size="default"
              placeholder={t("templateManage.templateSort")}
            />
          ) : (
            <ClassicTextInput
              type="number"
              value={draft.sort_order}
              onChange={(event) => onDraftChange({ ...draft, sort_order: event.target.value })}
              placeholder={t("templateManage.templateSort")}
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
          <PageActionButton onClick={onClose} disabled={busy} preset="secondary" size="md">
            {t("common.cancel")}
          </PageActionButton>
          <PageActionButton
            onClick={onConfirm}
            disabled={busy || !draft.category_id}
            preset="primary"
            size="md"
            loading={busy}
          >
            {t("templateManage.copyGlobal")}
          </PageActionButton>
        </div>
    </ModalShell>
  );
}
