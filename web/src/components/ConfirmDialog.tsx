import { useId } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { ModalShell } from "./ModalShell";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  error?: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  error = "",
  confirmLabel,
  cancelLabel,
  busy = false,
  destructive = true,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();

  if (!open) {
    return null;
  }

  const confirmClassName = destructive
    ? "bg-red-600 text-white shadow-red-600/20 hover:bg-red-500 focus-visible:ring-red-500 dark:bg-red-500 dark:hover:bg-red-400"
    : "bg-slate-950 text-white shadow-slate-950/15 hover:bg-slate-800 focus-visible:ring-slate-700 dark:bg-violet-500 dark:hover:bg-violet-400";

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeDisabled={busy}
      ariaLabelledBy={titleId}
      ariaDescribedBy={error ? `${descriptionId} ${errorId}` : descriptionId}
      overlayClassName="z-[90] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      panelClassName="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in"
    >
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200">
            <TriangleAlert size={18} />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-950 dark:text-white">
              {title}
            </h2>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {description}
            </p>
            {error ? (
              <div
                id={errorId}
                className="pf-confirm-dialog-error mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200"
              >
                {error}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pf-btn-secondary min-w-[72px] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex h-9 min-w-[72px] items-center justify-center rounded-lg px-3 text-sm font-semibold shadow-sm transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-60 ${confirmClassName}`}
          >
            {busy ? <Loader2 size={15} className="mr-2 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
    </ModalShell>
  );
}
