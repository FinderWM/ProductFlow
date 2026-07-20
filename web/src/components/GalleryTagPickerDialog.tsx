import { useEffect, useId, useMemo, useState } from "react";
import { Check, Tags, X } from "lucide-react";

import { asyncViewPhase, type AsyncViewState } from "../lib/asyncViewState";
import type { GalleryTag } from "../lib/types";
import { useI18n } from "../lib/preferences";
import { actionButtonComponentForAppearance, type LayoutActionAppearance } from "./layoutActionButtons";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "./loading/AsyncContent";
import { Skeleton } from "./loading/Skeleton";
import { ModalShell } from "./ModalShell";

interface GalleryTagPickerDialogProps {
  open: boolean;
  appearance: LayoutActionAppearance;
  tags: GalleryTag[];
  state: AsyncViewState;
  initialSelectedTagIds?: string[];
  title?: string;
  description?: string;
  confirmLabel?: string;
  maxSelection?: number | null;
  required?: boolean;
  busy?: boolean;
  error?: string;
  onRetry: () => void;
  onConfirm: (tagIds: string[]) => void;
  onClose: () => void;
}

const EMPTY_GALLERY_TAG_IDS: string[] = [];

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
  appearance,
  tags,
  state,
  initialSelectedTagIds = EMPTY_GALLERY_TAG_IDS,
  title,
  description,
  confirmLabel,
  maxSelection,
  required = false,
  busy = false,
  error = "",
  onRetry,
  onConfirm,
  onClose,
}: GalleryTagPickerDialogProps) {
  const { t } = useI18n();
  const ActionButtonComponent = actionButtonComponentForAppearance(appearance);
  const titleId = useId();
  const descriptionId = useId();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [unselectedTagIds, setUnselectedTagIds] = useState<string[]>([]);
  const [localError, setLocalError] = useState("");
  const phase = asyncViewPhase(state);
  const normalizedMaxSelection =
    typeof maxSelection === "number" && Number.isFinite(maxSelection) ? Math.max(1, Math.floor(maxSelection)) : null;
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
    if (!open || (phase !== "ready" && phase !== "empty")) {
      return;
    }
    const initialSelected = uniqueExistingTagIds(initialSelectedTagIds, tags);
    const boundedInitialSelected =
      normalizedMaxSelection === null ? initialSelected : initialSelected.slice(0, normalizedMaxSelection);
    const initialSelectedSet = new Set(boundedInitialSelected);
    setSelectedTagIds(boundedInitialSelected);
    setUnselectedTagIds(tags.filter((tag) => !initialSelectedSet.has(tag.id)).map((tag) => tag.id));
    setLocalError("");
  }, [initialSelectedTagIds, normalizedMaxSelection, open, phase, tags]);

  if (!open) {
    return null;
  }

  const moveToSelected = (tag: GalleryTag) => {
    if (selectedTagIds.includes(tag.id)) {
      return;
    }
    if (normalizedMaxSelection !== null && selectedTagIds.length >= normalizedMaxSelection) {
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
    <ActionButtonComponent
      key={tag.id}
      onClick={() => (selected ? removeSelected(tag) : moveToSelected(tag))}
      preset={selected ? "primary" : "secondary"}
      size="sm"
      leadingIcon={selected ? <Check size={13} /> : <Tags size={13} />}
      trailingIcon={selected ? <X size={13} className="opacity-70" /> : undefined}
      className="max-w-full min-w-0 [&_.pf-action-button__label]:truncate"
      title={tag.description || tag.name}
    >
      {tag.name}
    </ActionButtonComponent>
  );

  const visibleError = localError || error;
  const dialogTitle = title ?? t("gallery.tags.saveDialogTitle");
  const dialogDescription =
    description ??
    (normalizedMaxSelection === null
      ? t("gallery.tags.saveDialogDescriptionUnlimited")
      : t("gallery.tags.saveDialogDescription", { count: normalizedMaxSelection }));
  const dialogConfirmLabel = confirmLabel ?? t("common.save");
  const tagSections = (
    <>
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
            {t("gallery.tags.selected")}
          </div>
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {normalizedMaxSelection === null
              ? selectedTagIds.length
              : `${selectedTagIds.length}/${normalizedMaxSelection}`}
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
    </>
  );

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
        <ActionButtonComponent
          onClick={onClose}
          disabled={busy}
          aria-label={t("common.close")}
          title={t("common.close")}
          preset="secondary"
          size="icon-sm"
          leadingIcon={<X size={16} />}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <AsyncContent
          state={state}
          refreshIntent="background"
          loadingLabel={t("gallery.tags.loading")}
          skeleton={(
            <div className="space-y-5">
              {[1, 2].map((section) => (
                <div key={section} className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <div className="flex min-h-16 flex-wrap gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    {[1, 2, 3, 4].map((item) => (
                      <Skeleton key={item} className="h-8 w-24" rounded="lg" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          initialError={(
            <AsyncErrorState
              title={t("gallery.tags.loadFailed")}
              retryLabel={t("common.retry")}
              retryingLabel={t("gallery.tags.loading")}
              retrying={state.fetch === "fetching"}
              onRetry={onRetry}
            />
          )}
          paused={(
            <AsyncPausedState
              title={t("app.requestPaused.title")}
              message={t("app.requestPaused.message")}
              retryLabel={t("common.retry")}
              onRetry={onRetry}
            />
          )}
          inactive={null}
          empty={tagSections}
          refreshFeedback={
            state.error === "refresh" ? (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                <span>{t("gallery.tags.loadFailed")}</span>
                <button type="button" className="font-semibold underline" onClick={onRetry}>
                  {t("common.retry")}
                </button>
              </div>
            ) : null
          }
        >
          {tagSections}
        </AsyncContent>
        {visibleError ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
            {visibleError}
          </div>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
        <ActionButtonComponent
          onClick={onClose}
          disabled={busy}
          preset="secondary"
          size="md"
          className="min-w-20"
        >
          {t("common.cancel")}
        </ActionButtonComponent>
        <ActionButtonComponent
          onClick={handleConfirm}
          disabled={phase !== "ready" && phase !== "empty"}
          loading={busy}
          preset="primary"
          size="md"
          className="min-w-20"
        >
          {dialogConfirmLabel}
        </ActionButtonComponent>
      </div>
    </ModalShell>
  );
}
