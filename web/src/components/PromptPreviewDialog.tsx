import { useEffect, useId, useState } from "react";
import { Check, Copy, X } from "lucide-react";

import { copyTextToClipboard } from "../lib/clipboard";
import { useI18n } from "../lib/preferences";
import { ModalShell } from "./ModalShell";

export interface PromptPreview {
  title: string;
  text: string;
  meta?: string;
}

interface PromptPreviewDialogProps {
  preview: PromptPreview;
  onClose: () => void;
}

export function PromptPreviewDialog({ preview, onClose }: PromptPreviewDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTitle =
    copyState === "copied"
      ? t("promptPreview.copied")
      : copyState === "failed"
        ? t("promptPreview.copyFailed")
        : t("promptPreview.copy");

  useEffect(() => {
    if (copyState === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(preview.text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      ariaLabelledBy={titleId}
      overlayClassName="z-50 bg-slate-950/35 p-4 backdrop-blur-sm"
      panelClassName="max-h-[82vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 animate-spring-pop-in"
    >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div id={titleId} className="text-sm font-semibold text-slate-950">{preview.title}</div>
            {preview.meta ? <div className="mt-1 text-xs text-slate-500">{preview.meta}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label={t("promptPreview.close")}
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-800">
            {preview.text}
          </pre>
          <div className="mt-3 flex items-center justify-end gap-2">
            {copyState !== "idle" ? (
              <span
                className={
                  copyState === "copied"
                    ? "text-[11px] font-semibold text-emerald-700"
                    : "text-[11px] font-semibold text-red-700"
                }
              >
                {copyTitle}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleCopy}
              title={copyTitle}
              aria-label={t("promptPreview.copy")}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {copyState === "copied" ? <Check size={14} className="mr-1.5" /> : <Copy size={14} className="mr-1.5" />}
              {t("common.copy")}
            </button>
          </div>
        </div>
    </ModalShell>
  );
}
