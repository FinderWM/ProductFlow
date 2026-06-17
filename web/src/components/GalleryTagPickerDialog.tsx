import { useEffect, useId, useMemo, useState } from "react";
import { Check, Loader2, Tags, X } from "lucide-react";

import { ModalShell } from "./ModalShell";
import type { GalleryTag } from "../lib/types";
import { useI18n } from "../lib/preferences";

interface GalleryTagPickerDialogProps {
  open: boolean;
  tags: GalleryTag[];
  initialSelectedTagIds?: string[];
  title?: string;
  description?: string;
  confirmLabel?: string;
  maxSelection: number;
  required?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: (tagIds: string[]) => void;
  onClose: () => void;
}

function uniqueExistingTagIds(tagIds: readonly string[], tags: readonly GalleryTag[]): string[] {
  const existingIds = new Set(tags.map((tag) => tag.id));
  const seen = new Set<string>();
  return tagIds.filter((tagId) => {
    if (!existingIds.has(tagId) || seen.has(tagId)) {
      return false;
    }
    seen.add(tagId);
    return true;
  });
}

export function GalleryTagPickerDialog({
  open,
  tags,
  initialSelectedTagIds = [],
  title,
  description,
  confirmLabel,
  maxSelection,
  required = false,
  busy = false,
  error = "",
  onConfirm,
  onClose,
}: GalleryTagPickerDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [unselectedTagIds, setUnselectedTagIds] = useState<string[]>([]);
  const [localError, setLocalError] = useState("");
  const normalizedMaxSelection = Math.max(1, Math.floor(maxSelection || 1));
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const selectedTags = selectedTagIds.flatMap((tagId) => {
    const tag = tagsById.get(tagId);
    return tag ? [tag] : [];
  });
  const unselectedTags = unselectedTagIds.flatMap((tagId) => {
    const tag = tagsById.get(tagId);
    return tag ? [tag] : [];
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const initialSelected = uniqueExistingTagIds(initialSelectedTagIds, tags).slice(0, normalizedMaxSelection);
    const initialSelectedSet = new Set(initialSelected);
    setSelectedTagIds(initialSelected);
    setUnselectedTagIds(tags.filter((tag) => !initialSelectedSet.has(tag.id)).map((tag) => tag.id));
    setLocalError("");
  }, [initialSelectedTagIds, normalizedMaxSelection, open, tags]);

  if (!open) {
    return null;
  }

  const moveToSelected = (tag: GalleryTag) => {
    if (selectedTagIds.includes(tag.id)) {
      return;
    }
    if (selectedTagIds.length >= normalizedMaxSelection) {
      setLocalError(t("gallery.tags.maxSelected", { count: normalizedMaxSelection }));
      return;
    }
    setUnselectedTagIds((current) => current.filter((tagId) => tagId !== tag.id));
    setSelectedTagIds((current) => [...current, tag.id]);
    setLocalError("");
  };

  const removeSelected = (tag: GalleryTag) => {
    setSelectedTagIds((current) => current.filter((tagId) => tagId !== tag.id));
    setUnselectedTagIds((current) => (current.includes(tag.id) ? current : [...current, tag.id]));
    setLocalError("");
  };

  const handleConfirm = () => {
    if (required && selectedTagIds.length === 0) {
      setLocalError(t("gallery.tags.required"));
      return;
    }
    onConfirm(selectedTagIds);
  };

  const renderTagButton = (tag: GalleryTag, selected: boolean) => (
    <button
      key={tag.id}
      type="button"
      onClick={() => (selected ? removeSelected(tag) : moveToSelected(tag))}
      className={
        selected
          ? "inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100"
          : "inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200 dark:hover:border-violet-400/45 dark:hover:bg-violet-500/10"
      }
      title={tag.description || tag.name}
    >
      {selected ? <Check size={13} className="shrink-0" /> : <Tags size={13} className="shrink-0" />}
      <span className="min-w-0 truncate">{tag.name}</span>
      {selected ? <X size={13} className="shrink-0 opacity-70" /> : null}
    </button>
  );

  const visibleError = localError || error;
  const dialogTitle = title ?? t("gallery.tags.saveDialogTitle");
  const dialogDescription = description ?? t("gallery.tags.saveDialogDescription", { count: normalizedMaxSelection });
  const dialogConfirmLabel = confirmLabel ?? t("common.save");

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeDisabled={busy}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      overlayClassName="z-[92] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      panelClassName="flex max-h-[min(86svh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-slate-950 dark:text-white">
            {dialogTitle}
          </h2>
          <p id={descriptionId} className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {dialogDescription}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t("common.close")}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
              {t("gallery.tags.selected")}
            </div>
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {selectedTagIds.length}/{normalizedMaxSelection}
            </div>
          </div>
          <div className="flex min-h-12 flex-wrap content-start gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/35">
            {selectedTags.length ? (
              selectedTags.map((tag) => renderTagButton(tag, true))
            ) : (
              <span className="text-sm text-slate-400 dark:text-slate-500">{t("gallery.tags.noneSelected")}</span>
            )}
          </div>
        </section>
        <section className="mt-5 space-y-2">
          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
            {t("gallery.tags.unselected")}
          </div>
          <div className="flex min-h-20 flex-wrap content-start gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/20">
            {unselectedTags.length ? (
              unselectedTags.map((tag) => renderTagButton(tag, false))
            ) : (
              <span className="text-sm text-slate-400 dark:text-slate-500">{t("gallery.tags.noAvailable")}</span>
            )}
          </div>
        </section>
        {visibleError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
            {visibleError}
          </div>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex h-9 min-w-20 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className="inline-flex h-9 min-w-20 items-center justify-center rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
        >
          {busy ? <Loader2 size={15} className="mr-2 animate-spin" /> : null}
          {dialogConfirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
