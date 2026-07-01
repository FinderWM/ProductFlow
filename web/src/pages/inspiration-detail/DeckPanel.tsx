import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Download, FolderPlus, Loader2, Plus, RefreshCcw, Sparkles, Trash2, Wand2 } from "lucide-react";

import { ResourceLibraryModal } from "../../components/resource-library/ResourceLibraryModal";
import { api } from "../../lib/api";
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
}

const SLIDE_STATUS_LABEL: Record<string, string> = {
  pending: "待生成",
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
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

export function DeckPanel({ inspirationId, onOpenWorkflowNode }: DeckPanelProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
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
        <textarea
          value={sourceInput}
          onChange={(event) => setSourceInput(event.target.value)}
          placeholder={t("detail.deck.legacySourcePlaceholder")}
          rows={3}
          className="mb-2 w-full resize-none rounded-lg border border-slate-200/70 bg-white/60 px-3 py-2 text-slate-700 outline-none focus:border-indigo-400 dark:border-white/10 dark:bg-black/20 dark:text-slate-100"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={styleKey}
            onChange={(event) => setStyleKey(event.target.value)}
            className="rounded-lg border border-slate-200/70 bg-white/60 px-2 py-1.5 dark:border-white/10 dark:bg-black/20"
          >
            {styles.map((style) => (
              <option key={style.key} value={style.key}>
                {style.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={createMutation.isPending || !defaultGroupId}
            onClick={() => createMutation.mutate()}
            className="btn-primary-spring inline-flex items-center gap-1 px-3 py-1.5 text-sm"
          >
            {createMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {t("detail.deck.outline")}
          </button>
        </div>
      </section>

      {/* deck 历史 */}
      {sortedDecks.length > 0 ? (
        <section className="rounded-xl border border-slate-200/60 p-3 dark:border-white/10">
          <h3 className="mb-2 font-medium text-slate-700 dark:text-slate-200">{t("detail.deck.historyTitle")}</h3>
          <ul className="flex flex-col gap-1">
            {sortedDecks.map((item) => {
              const itemHasDeletedWorkflowNode = hasDeletedWorkflowDeckNode(item);
              const accessoryKind = deckHistoryAccessoryKind(item, Boolean(onOpenWorkflowNode));
              const itemWorkflowNodeId = item.workflow_node_id;

              return (
                <li key={item.id} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDeckId(item.id)}
                    className={`flex-1 truncate rounded-md px-2 py-1 text-left ${
                      selectedDeckId === item.id ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15" : "hover:bg-slate-100 dark:hover:bg-white/5"
                    }`}
                  >
                    {item.title}
                    <span className="ml-2 text-xs text-slate-400">
                      {t("detail.deck.slideCount", { count: item.slide_count })} · {t(DECK_STATUS_LABEL_KEYS[item.status])}
                      {item.generated_slide_count > 0 ? ` · ${t("detail.deck.generatedCount", { count: item.generated_slide_count })}` : ""}
                    </span>
                  </button>
                  {accessoryKind === "openWorkflowNode" && itemWorkflowNodeId && onOpenWorkflowNode ? (
                    <button
                      type="button"
                      title={t("detail.deck.openCanvasNode")}
                      onClick={() => onOpenWorkflowNode(itemWorkflowNodeId)}
                      className="rounded-md p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300"
                    >
                      <Sparkles size={15} />
                    </button>
                  ) : accessoryKind === "workflowDeleted" || accessoryKind === "workflowHint" ? (
                    <span
                      title={itemHasDeletedWorkflowNode ? t("detail.deck.sourceNodeDeleted") : t("detail.deck.dagDeckHint")}
                      className="rounded-md px-1 text-[11px] text-amber-600 dark:text-amber-300"
                    >
                      {itemHasDeletedWorkflowNode ? t("detail.deck.sourceNodeDeleted") : <Sparkles size={15} />}
                    </span>
                  ) : (
                    <button
                      type="button"
                      title={t("detail.deck.delete")}
                      onClick={() => deleteMutation.mutate(item.id)}
                      className="rounded-md p-1 text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* 选中的 deck 详情 */}
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
                <input
                  key={deck.id}
                  defaultValue={deck.title}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== deck.title) renameMutation.mutate(next);
                  }}
                  className="w-full truncate rounded-md bg-transparent font-medium text-slate-800 outline-none focus:bg-white/60 dark:text-slate-100 dark:focus:bg-black/20"
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
                  <button
                    type="button"
                    onClick={() => onOpenWorkflowNode(deck.workflow_node_id)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5"
                  >
                    {t("detail.deck.openCanvasNode")}
                  </button>
                ) : hasDeletedWorkflowDeckNode(deck) ? (
                  <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                    {t("detail.deck.sourceNodeDeleted")}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={deck.style_key ?? ""}
                  onChange={(event) => styleMutation.mutate(event.target.value)}
                  className="rounded-lg border border-slate-200/70 bg-white/60 px-2 py-1.5 text-xs dark:border-white/10 dark:bg-black/20"
                >
                  {styles.map((style) => (
                    <option key={style.key} value={style.key}>
                      {style.label}
                    </option>
                  ))}
                </select>
                <label className="cursor-pointer rounded-lg border border-slate-300 px-2 py-1.5 text-xs dark:border-white/15">
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
                <button
                  type="button"
                  disabled={generating || sampleMutation.isPending}
                  onClick={() => sampleMutation.mutate()}
                  className="btn-secondary-spring px-3 py-1.5 text-xs"
                >
                  {t("detail.deck.sample")}
                </button>
                <button
                  type="button"
                  disabled={generating || generateMutation.isPending}
                  onClick={() => generateMutation.mutate()}
                  className="btn-primary-spring inline-flex items-center gap-1 px-3 py-1.5 text-sm"
                >
                  {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {generating ? t("detail.deck.generating") : t("detail.deck.generate")}
                </button>
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
            <button
              type="button"
              disabled={exportMutation.isPending || !deckSupportsFrontendPptxExport(deck)}
              onClick={() => exportMutation.mutate()}
              className="btn-secondary-spring inline-flex items-center gap-1 px-3 py-1.5"
              title={!deckSupportsFrontendPptxExport(deck) ? t("detail.deck.noGeneratedSlides") : t("detail.deck.exportPptx")}
            >
              {exportMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {exportMutation.isPending && pptxProgress
                ? t("detail.deck.exportingPptx", pptxProgress)
                : t("detail.deck.exportPptx")}
            </button>
            {deck.pptx_url ? (
              <a
                href={deck.pptx_url}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-white"
                download={`${deck.title}.pptx`}
              >
                <Download size={15} />
                {t("detail.deck.downloadLegacyPptx")}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      <ResourceLibraryModal
        open={Boolean(materialSlideId) && deckAllowsLegacyMutation(deck)}
        onClose={() => setMaterialSlideId(null)}
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
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => {
          if (!readOnly && notes !== (slide.speaker_notes ?? "")) onSaveNotes(notes);
        }}
        placeholder="演讲备注"
        rows={2}
        readOnly={readOnly}
        className="w-full resize-none rounded-md border border-slate-200/60 bg-white/40 px-2 py-1 text-[11px] text-slate-600 outline-none dark:border-white/10 dark:bg-black/20 dark:text-slate-300"
      />
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-1">
        <button type="button" disabled={index === 0} onClick={onMoveUp} title="上移" className="rounded p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-30">
          <ChevronUp size={14} />
        </button>
        <button type="button" disabled={index === total - 1} onClick={onMoveDown} title="下移" className="rounded p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-30">
          <ChevronDown size={14} />
        </button>
        <button type="button" disabled={busy} onClick={onRegenerate} title="重新生成" className="rounded p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-40">
          <RefreshCcw size={14} />
        </button>
        <button type="button" disabled={busy} onClick={onPickMaterial} title="选配图" className="rounded p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-40">
          <Plus size={14} />
        </button>
        <button type="button" disabled={busy || !slide.material_url} onClick={onEnhance} title="增强配图" className="rounded p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-40">
          <Wand2 size={14} />
        </button>
        <button type="button" disabled={busy} onClick={onNotes} title="生成演讲备注" className="rounded p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-40">
          <Sparkles size={14} />
        </button>
        <button type="button" disabled={!slide.image_url} onClick={onSaveToLibrary} title="存资源库" className="rounded p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-40">
          <FolderPlus size={14} />
        </button>
        </div>
      ) : null}
    </div>
  );
}
