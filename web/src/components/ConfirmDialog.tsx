import { useId } from "react";
import { TriangleAlert } from "lucide-react";

import { actionButtonComponentForAppearance, type LayoutActionAppearance } from "./layoutActionButtons";
import { ModalShell } from "./ModalShell";

interface ConfirmDialogProps {
  open: boolean;
  appearance: LayoutActionAppearance;
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
  appearance,
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

  const ActionButtonComponent = actionButtonComponentForAppearance(appearance);

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
          <ActionButtonComponent
            onClick={onClose}
            disabled={busy}
            preset="secondary"
            size="md"
            className="min-w-[72px]"
          >
            {cancelLabel}
          </ActionButtonComponent>
          <ActionButtonComponent
            onClick={onConfirm}
            loading={busy}
            preset={destructive ? "danger" : "primary"}
            size="md"
            className="min-w-[72px]"
          >
            {confirmLabel}
          </ActionButtonComponent>
        </div>
    </ModalShell>
  );
}
