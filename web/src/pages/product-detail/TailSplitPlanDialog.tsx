import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";

import { useI18n } from "../../lib/preferences";
import type { ApplyTailSplitPlanItemInput, TailSplitPlan } from "../../lib/types";

interface TailSplitPlanDialogProps {
  open: boolean;
  nodeTitle: string;
  plan: TailSplitPlan | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (items: ApplyTailSplitPlanItemInput[]) => void;
}

export function TailSplitPlanDialog({
  open,
  nodeTitle,
  plan,
  busy,
  onClose,
  onConfirm,
}: TailSplitPlanDialogProps) {
  const { t } = useI18n();
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [instructionDrafts, setInstructionDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !plan) {
      return;
    }
    setSelectedItemIds(plan.items.map((item) => item.id));
    setInstructionDrafts(Object.fromEntries(plan.items.map((item) => [item.id, item.instruction])));
  }, [open, plan]);

  const selectedCount = selectedItemIds.length;
  const selectedIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const selectedItems = useMemo(
    () =>
      plan?.items
        .filter((item) => selectedIdSet.has(item.id))
        .map((item) => ({
          id: item.id,
          instruction: (instructionDrafts[item.id] ?? item.instruction).trim(),
        })) ?? [],
    [instructionDrafts, plan, selectedIdSet],
  );
  const hasBlankSelectedInstruction = selectedItems.some((item) => !item.instruction);

  if (!open || !plan) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[min(88vh,960px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#0f1726]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-white">
              <Sparkles size={16} className="text-fuchsia-600 dark:text-fuchsia-300" />
              <span>{t("detail.tailPlan.title", { title: nodeTitle })}</span>
            </div>
            <div className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t("detail.tailPlan.subtitle")}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
            aria-label={t("common.cancel")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto px-5 py-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <aside className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-[#0b1220]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {t("detail.tailPlan.summary")}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{plan.source_summary}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200">
              {t("detail.tailPlan.selectedCount", { count: selectedCount, total: plan.items.length })}
            </div>
          </aside>

          <div className="space-y-3">
            {plan.items.map((item) => {
              const selected = selectedIdSet.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 transition-colors ${
                    selected
                      ? "border-fuchsia-200 bg-fuchsia-50/70 dark:border-fuchsia-400/35 dark:bg-fuchsia-500/10"
                      : "border-slate-200 bg-white/90 opacity-70 dark:border-slate-700 dark:bg-[#0b1220]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                        {t("detail.tailPlan.itemOrder", { order: item.order })}
                      </div>
                      <div className="mt-1 text-base font-semibold text-zinc-950 dark:text-white">{item.title}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedItemIds((current) =>
                          selected ? current.filter((itemId) => itemId !== item.id) : [...current, item.id],
                        )
                      }
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                        selected
                          ? "bg-white text-fuchsia-700 ring-1 ring-fuchsia-200 dark:bg-slate-950/80 dark:text-fuchsia-200 dark:ring-fuchsia-400/35"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {selected ? <Check size={12} /> : null}
                      {selected ? t("detail.tailPlan.remove") : t("detail.tailPlan.keep")}
                    </button>
                  </div>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                        {t("detail.tailPlan.instruction")}
                      </div>
                      <textarea
                        value={instructionDrafts[item.id] ?? item.instruction}
                        onChange={(event) =>
                          setInstructionDrafts((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        disabled={busy || !selected}
                        rows={4}
                        className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:focus:border-fuchsia-400 dark:focus:ring-fuchsia-400/15 dark:disabled:bg-slate-900/70"
                        aria-label={t("detail.tailPlan.instruction")}
                      />
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                        {t("detail.tailPlan.visualIntent")}
                      </div>
                      <div className="mt-1">{item.visual_intent}</div>
                    </div>
                    {item.source_refs.length ? (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                          {t("detail.tailPlan.sourceRefs")}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {item.source_refs.map((sourceRef) => (
                            <span
                              key={`${item.id}-${sourceRef}`}
                              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300"
                            >
                              {sourceRef}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {!selectedCount
              ? t("detail.tailPlan.footerEmpty")
              : hasBlankSelectedInstruction
                ? t("detail.tailPlan.instructionEmpty")
                : t("detail.tailPlan.footerReady")}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-900/70"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(selectedItems)}
              disabled={busy || !selectedCount || hasBlankSelectedInstruction}
              className="inline-flex items-center rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-fuchsia-500 disabled:opacity-60 dark:bg-gradient-to-r dark:from-fuchsia-500 dark:to-violet-500"
            >
              {t("detail.tailPlan.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
