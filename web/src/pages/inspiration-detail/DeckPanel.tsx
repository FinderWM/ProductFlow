import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Download, FolderPlus, Loader2, Plus, RefreshCcw, Sparkles, Trash2, Wand2 } from "lucide-react";

import {
  actionButtonClassNameForAppearance,
  actionButtonComponentForAppearance,
  renderActionButtonInner,
  actionSurfaceClassNameForAppearance,
  type LayoutActionAppearance,
} from "../../components/layoutActionButtons";
import { LayoutActionSurfaceButton } from "../../components/LayoutActionSurfaceButton";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../../components/loading/AsyncContent";
import { Skeleton, SkeletonRows } from "../../components/loading/Skeleton";
import { ResourceLibraryModal } from "../../components/resource-library/ResourceLibraryModal";
import {
  ClassicSelectField,
  ClassicTextInput,
  ClassicTextarea,
} from "../../components/classicInputs";
import {
  WorkspaceSelectField as SelectField,
  WorkspaceTextInput,
  WorkspaceTextarea,
} from "../../components/workspaceInputs";
import { api } from "../../lib/api";
import { asyncViewStateFromQuery, combineAsyncViewStates } from "../../lib/asyncViewState";
import { exportDeckAsPptx } from "../../lib/deckPptxExport";
import { useI18n } from "../../lib/preferences";
import type { Deck, DeckSlide } from "../../lib/types";
import { DECK_STATUS_LABEL_KEYS } from "./deckStatus";
import {
  canOpenWorkflowDeckNode,
  deckAllowsLegacyMutation,
  deckHistoryAccessoryKind,
  deckSupportsFrontendPptxExport,
  hasDeletedWorkflowDeckNode,
  isWorkflowDeck,
} from "./deckPanelState";

interface DeckPanelProps {
  inspirationId: string;
  onOpenWorkflowNode?: (nodeId: string) => void;
  workspaceSubpage?: boolean;
}

const SLIDE_STATUS_LABEL: Record<string, string> = {
  pending: "待生成",
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
};

const DECK_SELECTABLE_SURFACE_STYLE: CSSProperties = {
  ["--pf-action-radius" as string]: "var(--pf-radius-md)",
  ["--pf-action-shadow" as string]: "none",
  ["--pf-action-shadow-hover" as string]: "none",
};

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error) {
    return String((error as { detail?: unknown }).detail ?? "操作失败");
  }
  if (error instanceof Error) return error.message;
  return "操作失败";
}

function deckIsActive(deck: Deck | undefined): boolean {
  if (!deck) return false;
  if (deck.status === "generating") return true;
  return deck.slides.some((slide) => slide.slide_status === "queued" || slide.slide_status === "running");
}

export function DeckPanel({ inspirationId, onOpenWorkflowNode, workspaceSubpage = false }: DeckPanelProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const actionAppearance: LayoutActionAppearance = workspaceSubpage ? "workspace" : "classic";
  const ActionButton = actionButtonComponentForAppearance(actionAppearance);
  const deckLegacyDownloadClassName = actionButtonClassNameForAppearance(actionAppearance, {
    preset: "secondary",
    size: "md",
  });
  const deckPanelStyleUploadClass = actionSurfaceClassNameForAppearance(actionAppearance, {
    preset: "secondary",
    focusWithin: true,
    className: "cursor-pointer px-2 py-1.5 text-xs",
  });
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [sourceInput, setSourceInput] = useState("");
  const [styleKey, setStyleKey] = useState("clean_business");
  const [error, setError] = useState<string | null>(null);
  const [materialSlideId, setMaterialSlideId] = useState<string | null>(null);
  const [pptxProgress, setPptxProgress] = useState<{ completed: number; total: number } | null>(null);

  const groupsQuery = useQuery({
    queryKey: ["my-generation-resource-groups"],
    queryFn: () => api.listMyGenerationResourceGroups(),
  });
  const stylesQuery = useQuery({ queryKey: ["deck-styles"], queryFn: () => api.listDeckStyles() });
  const decksQuery = useQuery({
    queryKey: ["decks", inspirationId],
    queryFn: () => api.listDecks(inspirationId),
  });
  const deckQuery = useQuery({
    queryKey: ["deck", selectedDeckId],
    queryFn: () => api.getDeck(selectedDeckId as string),
    enabled: Boolean(selectedDeckId),
    refetchInterval: (query) => (deckIsActive(query.state.data as Deck | undefined) ? 1500 : false),
  });

  const groupsViewState = asyncViewStateFromQuery({
    active: true,
    data: groupsQuery.data,
    dataUpdatedAt: groupsQuery.dataUpdatedAt,
    isSuccess: groupsQuery.isSuccess,
    isError: groupsQuery.isError,
    fetchStatus: groupsQuery.fetchStatus,
    isEmpty: (data) => data.length === 0,
  });
  const stylesViewState = asyncViewStateFromQuery({
    active: true,
    data: stylesQuery.data,
    dataUpdatedAt: stylesQuery.dataUpdatedAt,
    isSuccess: stylesQuery.isSuccess,
    isError: stylesQuery.isError,
    fetchStatus: stylesQuery.fetchStatus,
    isEmpty: (data) => data.length === 0,
  });
  const creationViewState = combineAsyncViewStates({
    active: true,
    critical: [groupsViewState, stylesViewState],
    isEmpty: (groupsQuery.data?.length ?? 0) === 0 || (stylesQuery.data?.length ?? 0) === 0,
  });
  const decksViewState = asyncViewStateFromQuery({
    active: true,
    data: decksQuery.data,
    dataUpdatedAt: decksQuery.dataUpdatedAt,
    isSuccess: decksQuery.isSuccess,
    isError: decksQuery.isError,
    fetchStatus: decksQuery.fetchStatus,
    isEmpty: (data) => data.length === 0,
  });
  const selectedDeckViewState = asyncViewStateFromQuery({
    active: Boolean(selectedDeckId),
    data: deckQuery.data,
    dataUpdatedAt: deckQuery.dataUpdatedAt,
    isSuccess: deckQuery.isSuccess,
    isError: deckQuery.isError,
    fetchStatus: deckQuery.fetchStatus,
    isEmpty: () => false,
  });

  const deck = deckQuery.data;
  const defaultGroupId = groupsQuery.data?.[0]?.id ?? null;

  const refreshDecks = async () => {
    await queryClient.invalidateQueries({ queryKey: ["decks", inspirationId] });
    if (selectedDeckId) await queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] });
  };

  const createMutation = useMutation({
    mutationFn: () => {
      if (!defaultGroupId) throw new Error("没有可用的生成分组");
      return api.createDeck(inspirationId, {
        resource_group_id: defaultGroupId,
        source_input: sourceInput.trim() || undefined,
        style_key: styleKey,
      });
    },
    onSuccess: async (created) => {
      setError(null);
      setSourceInput("");
      setSelectedDeckId(created.id);
      await refreshDecks();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const styleMutation = useMutation({
    mutationFn: (key: string) => api.setDeckStyle(deck!.id, { style_key: key }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] }),
    onError: (err) => setError(errorMessage(err)),
  });
  const generateMutation = useMutation({
    mutationFn: () => api.generateDeck(deck!.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] }),
    onError: (err) => setError(errorMessage(err)),
  });
  const regenerateMutation = useMutation({
    mutationFn: (slideId: string) => api.regenerateDeckSlide(slideId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] }),
    onError: (err) => setError(errorMessage(err)),
  });
  const notesMutation = useMutation({
    mutationFn: (slideId: string) => api.generateDeckSlideSpeakerNotes(slideId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] }),
    onError: (err) => setError(errorMessage(err)),
  });
  const enhanceMutation = useMutation({
    mutationFn: (slideId: string) => api.enhanceDeckSlideMaterial(slideId, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] }),
    onError: (err) => setError(errorMessage(err)),
  });
  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!deck) {
        throw new Error(t("detail.deck.noGeneratedSlides"));
      }
      await exportDeckAsPptx(deck, {
        onProgress: setPptxProgress,
      });
    },
    onSuccess: () => {
      setPptxProgress(null);
      setError(null);
    },
    onError: (err) => {
      setPptxProgress(null);
      setError(errorMessage(err));
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (deckId: string) => api.deleteDeck(deckId),
    onSuccess: async (_data, deckId) => {
      if (selectedDeckId === deckId) setSelectedDeckId(null);
      await refreshDecks();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const setMaterialMutation = useMutation({
    mutationFn: (input: { slideId: string; assetId: string }) =>
      api.setDeckSlideMaterial(input.slideId, { source_type: "resource_library", asset_id: input.assetId }),
    onSuccess: () => {
      setMaterialSlideId(null);
      void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const sampleMutation = useMutation({
    mutationFn: () => api.generateDeckSample(deck!.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] }),
    onError: (err) => setError(errorMessage(err)),
  });
  const reorderMutation = useMutation({
    mutationFn: (slideIds: string[]) => api.reorderDeckSlides(deck!.id, slideIds),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] }),
    onError: (err) => setError(errorMessage(err)),
  });
  const saveNotesMutation = useMutation({
    mutationFn: (input: { slideId: string; notes: string }) =>
      api.updateDeckSlide(input.slideId, { speaker_notes: input.notes }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] }),
    onError: (err) => setError(errorMessage(err)),
  });
  const renameMutation = useMutation({
    mutationFn: (title: string) => api.renameDeck(deck!.id, { title }),
    onSuccess: () => refreshDecks(),
    onError: (err) => setError(errorMessage(err)),
  });
  const styleRefMutation = useMutation({
    mutationFn: (file: File) => api.uploadDeckStyleReference(deck!.id, file),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["deck", selectedDeckId] }),
    onError: (err) => setError(errorMessage(err)),
  });
  const saveToLibraryMutation = useMutation({
    mutationFn: (slideId: string) => api.saveDeckSlideToResourceLibrary(slideId),
    onError: (err) => setError(errorMessage(err)),
  });

  const moveSlide = (index: number, direction: -1 | 1) => {
    if (!deck) return;
    const ids = deck.slides.map((slide) => slide.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderMutation.mutate(ids);
  };

  const styles = stylesQuery.data ?? [];
  const generating = deckIsActive(deck);
  const workflowDeck = isWorkflowDeck(deck);
  const LayoutSelectField = workspaceSubpage ? SelectField : ClassicSelectField;
  const LayoutTextInput = workspaceSubpage ? WorkspaceTextInput : ClassicTextInput;
  const LayoutTextarea = workspaceSubpage ? WorkspaceTextarea : ClassicTextarea;

  const decks = decksQuery.data ?? [];
  const sortedDecks = useMemo(() => decks, [decks]);

  useEffect(() => {
    if (workflowDeck && materialSlideId) setMaterialSlideId(null);
  }, [materialSlideId, workflowDeck]);

  return (
    <div className="flex flex-col gap-4 p-1 text-sm">
      {error ? (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {/* 新建演示文稿 */}
      <section className="rounded-xl border border-slate-200/60 p-3 dark:border-white/10">
        <h3 className="mb-2 font-medium text-slate-700 dark:text-slate-200">{t("detail.deck.newLegacyTitle")}</h3>
        <LayoutTextarea
          value={sourceInput}
          onChange={(event) => setSourceInput(event.target.value)}
          placeholder={t("detail.deck.legacySourcePlaceholder")}
          size="default"
          minRows={3}
          className="mb-2"
        />
        <div className="flex flex-wrap items-center gap-2">
          <AsyncContent
            state={creationViewState}
            refreshIntent="background"
            loadingLabel={t("app.loading")}
            skeleton={(
              <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-44" rounded="lg" />
                <Skeleton className="h-9 w-24" rounded="lg" />
              </div>
            )}
            initialError={(
              <AsyncErrorState
                title={t("detail.deck.configLoadFailed")}
                retryLabel={t("common.retry")}
                retryingLabel={t("app.loading")}
                retrying={creationViewState.fetch === "fetching"}
                onRetry={() => {
                  void Promise.all([groupsQuery.refetch(), stylesQuery.refetch()]);
                }}
              />
            )}
            paused={(
              <AsyncPausedState
                title={t("app.requestPaused.title")}
                message={t("app.requestPaused.message")}
                retryLabel={t("common.retry")}
                onRetry={() => {
                  void Promise.all([groupsQuery.refetch(), stylesQuery.refetch()]);
                }}
              />
            )}
            inactive={null}
            empty={(
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t("detail.deck.configUnavailable")}
              </div>
            )}
            refreshFeedback={creationViewState.error === "refresh" ? (
              <AsyncErrorState
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100"
                title={t("detail.deck.configLoadFailed")}
                retryLabel={t("common.retry")}
                retryingLabel={t("app.loading")}
                retrying={creationViewState.fetch === "fetching"}
                onRetry={() => {
                  void Promise.all([groupsQuery.refetch(), stylesQuery.refetch()]);
                }}
              />
            ) : null}
          >
            <div className="flex flex-wrap items-center gap-2">
              <LayoutSelectField
                value={styleKey}
                onChange={setStyleKey}
                size="compact"
                ariaLabel={t("detail.deck.styleReference")}
                options={styles.map((style) => ({
                  value: style.key,
                  label: style.label,
                }))}
              />
              <ActionButton
                disabled={createMutation.isPending || !defaultGroupId}
                onClick={() => createMutation.mutate()}
                preset="primary"
                size="md"
                loading={createMutation.isPending}
                leadingIcon={<Plus size={15} />}
              >
                {t("detail.deck.outline")}
              </ActionButton>
            </div>
          </AsyncContent>
        </div>
      </section>

      {/* deck 历史 */}
      <section className="rounded-xl border border-slate-200/60 p-3 dark:border-white/10">
        <h3 className="mb-2 font-medium text-slate-700 dark:text-slate-200">{t("detail.deck.historyTitle")}</h3>
        <AsyncContent
          state={decksViewState}
          refreshIntent="background"
          loadingLabel={t("app.loading")}
          skeleton={(
            <div className="space-y-2">
              {[1, 2, 3].map((index) => <Skeleton key={index} className="h-12 w-full" rounded="lg" />)}
            </div>
          )}
          initialError={(
            <AsyncErrorState
              title={t("detail.deck.historyLoadFailed")}
              retryLabel={t("common.retry")}
              retryingLabel={t("app.loading")}
              retrying={decksViewState.fetch === "fetching"}
              onRetry={() => void decksQuery.refetch()}
            />
          )}
          paused={(
            <AsyncPausedState
              title={t("app.requestPaused.title")}
              message={t("app.requestPaused.message")}
              retryLabel={t("common.retry")}
              onRetry={() => void decksQuery.refetch()}
            />
          )}
          inactive={null}
          empty={(
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {t("detail.deck.historyEmpty")}
            </div>
          )}
          refreshFeedback={decksViewState.error === "refresh" ? (
            <AsyncErrorState
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100"
              title={t("detail.deck.historyLoadFailed")}
              retryLabel={t("common.retry")}
              retryingLabel={t("app.loading")}
              retrying={decksViewState.fetch === "fetching"}
              onRetry={() => void decksQuery.refetch()}
            />
          ) : null}
        >
          <ul className="flex flex-col gap-1">
            {sortedDecks.map((item) => {
              const itemHasDeletedWorkflowNode = hasDeletedWorkflowDeckNode(item);
              const accessoryKind = deckHistoryAccessoryKind(item, Boolean(onOpenWorkflowNode));
              const itemWorkflowNodeId = item.workflow_node_id;

              return (
                <li key={item.id} className="flex items-center justify-between gap-2">
                  <LayoutActionSurfaceButton
                    appearance={actionAppearance}
                    preset="secondary"
                    onClick={() => setSelectedDeckId(item.id)}
                    aria-pressed={selectedDeckId === item.id}
                    style={DECK_SELECTABLE_SURFACE_STYLE}
                    className="min-w-0 flex-1 px-2 py-1 text-left"
                  >
                    <span className="block truncate">{item.title}</span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {t("detail.deck.slideCount", { count: item.slide_count })} · {t(DECK_STATUS_LABEL_KEYS[item.status])}
                      {item.generated_slide_count > 0 ? ` · ${t("detail.deck.generatedCount", { count: item.generated_slide_count })}` : ""}
                    </span>
                  </LayoutActionSurfaceButton>
                  {accessoryKind === "openWorkflowNode" && itemWorkflowNodeId && onOpenWorkflowNode ? (
                    <ActionButton
                      title={t("detail.deck.openCanvasNode")}
                      onClick={() => onOpenWorkflowNode(itemWorkflowNodeId)}
                      preset="secondary"
                      size="icon-sm"
                      leadingIcon={<Sparkles size={15} />}
                    />
                  ) : accessoryKind === "workflowDeleted" || accessoryKind === "workflowHint" ? (
                    <span
                      title={itemHasDeletedWorkflowNode ? t("detail.deck.sourceNodeDeleted") : t("detail.deck.dagDeckHint")}
                      className="rounded-md px-1 text-[11px] text-amber-600 dark:text-amber-300"
                    >
                      {itemHasDeletedWorkflowNode ? t("detail.deck.sourceNodeDeleted") : <Sparkles size={15} />}
                    </span>
                  ) : (
                    <ActionButton
                      title={t("detail.deck.delete")}
                      onClick={() => deleteMutation.mutate(item.id)}
                      preset="danger"
                      size="icon-sm"
                      leadingIcon={<Trash2 size={15} />}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </AsyncContent>
      </section>

      {/* 选中的 deck 详情 */}
      <AsyncContent
        state={selectedDeckViewState}
        refreshIntent="silent-poll"
        loadingLabel={t("app.loading")}
        skeleton={(
          <section className="rounded-xl border border-slate-200/60 p-3 dark:border-white/10">
            <Skeleton className="h-5 w-2/5" />
            <SkeletonRows count={3} className="mt-3" />
          </section>
        )}
        initialError={(
          <AsyncErrorState
            title={t("detail.deck.detailLoadFailed")}
            retryLabel={t("common.retry")}
            retryingLabel={t("app.loading")}
            retrying={selectedDeckViewState.fetch === "fetching"}
            onRetry={() => void deckQuery.refetch()}
          />
        )}
        paused={(
          <AsyncPausedState
            title={t("app.requestPaused.title")}
            message={t("app.requestPaused.message")}
            retryLabel={t("common.retry")}
            onRetry={() => void deckQuery.refetch()}
          />
        )}
        inactive={null}
        empty={null}
        refreshFeedback={selectedDeckViewState.error === "refresh" ? (
          <AsyncErrorState
            className="pf-async-error mt-3 rounded-xl border px-4 py-3 text-sm"
            title={t("detail.deck.detailLoadFailed")}
            retryLabel={t("common.retry")}
            retryingLabel={t("app.loading")}
            retrying={selectedDeckViewState.fetch === "fetching"}
            onRetry={() => void deckQuery.refetch()}
          />
        ) : selectedDeckViewState.fetch === "paused" ? (
          <AsyncPausedState
            className="pf-async-paused mt-3 rounded-xl border px-4 py-3 text-sm"
            title={t("app.requestPaused.title")}
            message={t("app.requestPaused.message")}
            retryLabel={t("common.retry")}
            onRetry={() => void deckQuery.refetch()}
          />
        ) : null}
      >
        {deck ? (
        <section className="rounded-xl border border-slate-200/60 p-3 dark:border-white/10">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              {!deckAllowsLegacyMutation(deck) ? (
                <div
                  title={deck.title}
                  className="w-full truncate rounded-md bg-transparent font-medium text-slate-800 dark:text-slate-100"
                >
                  {deck.title}
                </div>
              ) : (
                <LayoutTextInput
                  key={deck.id}
                  defaultValue={deck.title}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== deck.title) renameMutation.mutate(next);
                  }}
                  size="compact"
                  className="truncate font-medium"
                />
              )}
              <div className="text-xs text-slate-400">
                {t(DECK_STATUS_LABEL_KEYS[deck.status])} · {t("detail.deck.slideCount", { count: deck.slides.length })} ·{" "}
                {t("detail.deck.generatedCount", { count: deck.generated_slide_count })}
                {deck.style_reference_asset_id ? ` · ${t("detail.deck.customStyle")}` : ""}
              </div>
            </div>
            {!deckAllowsLegacyMutation(deck) ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="max-w-xs rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                  {t("detail.deck.dagDeckHint")}
                </div>
                {canOpenWorkflowDeckNode(deck) && deck.workflow_node_id && onOpenWorkflowNode ? (
                  <ActionButton
                    onClick={() => onOpenWorkflowNode(deck.workflow_node_id)}
                    preset="secondary"
                    size="sm"
                  >
                    {t("detail.deck.openCanvasNode")}
                  </ActionButton>
                ) : hasDeletedWorkflowDeckNode(deck) ? (
                  <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                    {t("detail.deck.sourceNodeDeleted")}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <LayoutSelectField
                  value={deck.style_key ?? ""}
                  onChange={(value) => styleMutation.mutate(value)}
                  size="compact"
                  ariaLabel={t("detail.deck.styleReference")}
                  options={styles.map((style) => ({
                    value: style.key,
                    label: style.label,
                  }))}
                />
                <label className={deckPanelStyleUploadClass}>
                  {t("detail.deck.styleReference")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) styleRefMutation.mutate(file);
                      event.target.value = "";
                    }}
                  />
                </label>
                <ActionButton
                  disabled={generating || sampleMutation.isPending}
                  onClick={() => sampleMutation.mutate()}
                  preset="secondary"
                  size="sm"
                >
                  {t("detail.deck.sample")}
                </ActionButton>
                <ActionButton
                  disabled={generating || generateMutation.isPending}
                  onClick={() => generateMutation.mutate()}
                  preset="primary"
                  size="md"
                  loading={generating || generateMutation.isPending}
                  leadingIcon={<Sparkles size={15} />}
                >
                  {generating ? t("detail.deck.generating") : t("detail.deck.generate")}
                </ActionButton>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {deck.slides.map((slide, index) => (
              <DeckSlideCard
                key={slide.id}
                slide={slide}
                index={index}
                total={deck.slides.length}
                readOnly={workflowDeck}
                workspaceSubpage={workspaceSubpage}
                onRegenerate={() => regenerateMutation.mutate(slide.id)}
                onNotes={() => notesMutation.mutate(slide.id)}
                onEnhance={() => enhanceMutation.mutate(slide.id)}
                onPickMaterial={() => setMaterialSlideId(slide.id)}
                onMoveUp={() => moveSlide(index, -1)}
                onMoveDown={() => moveSlide(index, 1)}
                onSaveNotes={(notes) => saveNotesMutation.mutate({ slideId: slide.id, notes })}
                onSaveToLibrary={() => saveToLibraryMutation.mutate(slide.id)}
                busy={
                  (regenerateMutation.isPending && regenerateMutation.variables === slide.id) ||
                  (notesMutation.isPending && notesMutation.variables === slide.id) ||
                  (enhanceMutation.isPending && enhanceMutation.variables === slide.id)
                }
              />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200/40 pt-3 dark:border-white/5">
            <ActionButton
              disabled={exportMutation.isPending || !deckSupportsFrontendPptxExport(deck)}
              onClick={() => exportMutation.mutate()}
              preset="secondary"
              size="md"
              loading={exportMutation.isPending}
              leadingIcon={<Download size={15} />}
              title={!deckSupportsFrontendPptxExport(deck) ? t("detail.deck.noGeneratedSlides") : t("detail.deck.exportPptx")}
            >
              {exportMutation.isPending && pptxProgress
                ? t("detail.deck.exportingPptx", pptxProgress)
                : t("detail.deck.exportPptx")}
            </ActionButton>
            {deck.pptx_url ? (
              <a
                href={deck.pptx_url}
                className={deckLegacyDownloadClassName}
                download={`${deck.title}.pptx`}
              >
                {renderActionButtonInner({
                  leadingIcon: <Download size={15} />,
                  label: t("detail.deck.downloadLegacyPptx"),
                })}
              </a>
            ) : null}
          </div>
        </section>
        ) : null}
      </AsyncContent>

      <ResourceLibraryModal
        open={Boolean(materialSlideId) && deckAllowsLegacyMutation(deck)}
        onClose={() => setMaterialSlideId(null)}
        appearance={workspaceSubpage ? "workspace" : "classic"}
        canRead
        selectLabel="设为配图"
        onSelectAsset={(asset) => {
          if (materialSlideId) setMaterialMutation.mutate({ slideId: materialSlideId, assetId: asset.id });
        }}
      />
    </div>
  );
}

interface DeckSlideCardProps {
  slide: DeckSlide;
  index: number;
  total: number;
  busy: boolean;
  readOnly: boolean;
  workspaceSubpage?: boolean;
  onRegenerate: () => void;
  onNotes: () => void;
  onEnhance: () => void;
  onPickMaterial: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSaveNotes: (notes: string) => void;
  onSaveToLibrary: () => void;
}

function DeckSlideCard({
  slide,
  index,
  total,
  busy,
  readOnly,
  workspaceSubpage = false,
  onRegenerate,
  onNotes,
  onEnhance,
  onPickMaterial,
  onMoveUp,
  onMoveDown,
  onSaveNotes,
  onSaveToLibrary,
}: DeckSlideCardProps) {
  const [notes, setNotes] = useState(slide.speaker_notes ?? "");
  const actionAppearance: LayoutActionAppearance = workspaceSubpage ? "workspace" : "classic";
  const ActionButton = actionButtonComponentForAppearance(actionAppearance);
  const LayoutTextarea = workspaceSubpage ? WorkspaceTextarea : ClassicTextarea;
  useEffect(() => {
    setNotes(slide.speaker_notes ?? "");
  }, [slide.speaker_notes]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200/60 p-2 dark:border-white/10">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
          {index + 1}. {slide.title}
        </span>
        <span className="shrink-0 text-[11px] text-slate-400">
          {SLIDE_STATUS_LABEL[slide.slide_status] ?? slide.slide_status}
        </span>
      </div>
      <div className="relative aspect-video overflow-hidden rounded-md bg-slate-100 dark:bg-white/5">
        {slide.image_url ? (
          <img src={slide.image_url} alt={slide.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">
            {slide.slide_status === "failed" ? slide.last_error || "生成失败" : "尚未生成"}
          </div>
        )}
        {(slide.slide_status === "running" || slide.slide_status === "queued") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Loader2 size={20} className="animate-spin text-white" />
          </div>
        )}
      </div>
      <LayoutTextarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => {
          if (!readOnly && notes !== (slide.speaker_notes ?? "")) onSaveNotes(notes);
        }}
        placeholder="演讲备注"
        minRows={2}
        readOnly={readOnly}
        size="compact"
        className="text-[11px] text-slate-600 dark:text-slate-300"
      />
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-1">
          <ActionButton
            type="button"
            disabled={index === 0}
            onClick={onMoveUp}
            title="上移"
            preset="secondary"
            size="icon-sm"
            leadingIcon={<ChevronUp size={14} />}
          />
          <ActionButton
            type="button"
            disabled={index === total - 1}
            onClick={onMoveDown}
            title="下移"
            preset="secondary"
            size="icon-sm"
            leadingIcon={<ChevronDown size={14} />}
          />
          <ActionButton
            type="button"
            disabled={busy}
            onClick={onRegenerate}
            title="重新生成"
            preset="secondary"
            size="icon-sm"
            leadingIcon={<RefreshCcw size={14} />}
          />
          <ActionButton
            type="button"
            disabled={busy}
            onClick={onPickMaterial}
            title="选配图"
            preset="secondary"
            size="icon-sm"
            leadingIcon={<Plus size={14} />}
          />
          <ActionButton
            type="button"
            disabled={busy || !slide.material_url}
            onClick={onEnhance}
            title="增强配图"
            preset="secondary"
            size="icon-sm"
            leadingIcon={<Wand2 size={14} />}
          />
          <ActionButton
            type="button"
            disabled={busy}
            onClick={onNotes}
            title="生成演讲备注"
            preset="secondary"
            size="icon-sm"
            leadingIcon={<Sparkles size={14} />}
          />
          <ActionButton
            type="button"
            disabled={!slide.image_url}
            onClick={onSaveToLibrary}
            title="存资源库"
            preset="secondary"
            size="icon-sm"
            leadingIcon={<FolderPlus size={14} />}
          />
        </div>
      ) : null}
    </div>
  );
}
