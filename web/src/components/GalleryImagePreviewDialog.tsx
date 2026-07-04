import { Download, X } from "lucide-react";
import type { ReactNode } from "react";

import { api } from "../lib/api";
import { useI18n } from "../lib/preferences";
import { actionButtonClassNameForAppearance, type LayoutActionAppearance } from "./layoutActionButtons";
import { ModalShell } from "./ModalShell";
import { ZoomableImage } from "./ZoomableImage";

export interface GalleryPreviewMetadataRow {
  label: string;
  value: string;
}

interface GalleryImagePreviewDialogProps {
  appearance: LayoutActionAppearance;
  ariaLabel: string;
  imageUrl: string;
  imageAlt: string;
  title: string;
  subtitle?: string;
  body: ReactNode;
  imageInteractive?: boolean;
  metadataRows?: GalleryPreviewMetadataRow[];
  providerNotes?: string[];
  providerNotesTitle: string;
  downloadUrl: string;
  downloadLabel: string;
  closeLabel: string;
  footerExtra?: ReactNode;
  className?: string;
  onClose: () => void;
}

export function GalleryImagePreviewDialog({
  appearance,
  ariaLabel,
  imageUrl,
  imageAlt,
  title,
  subtitle,
  body,
  imageInteractive = true,
  metadataRows = [],
  providerNotes = [],
  providerNotesTitle,
  downloadUrl,
  downloadLabel,
  closeLabel,
  footerExtra,
  className = "",
  onClose,
}: GalleryImagePreviewDialogProps) {
  const { t } = useI18n();
  const closeActionClassName = actionButtonClassNameForAppearance(appearance, {
    preset: "secondary",
    size: "icon-md",
  });
  const downloadActionClassName = actionButtonClassNameForAppearance(appearance, {
    preset: "primary",
    size: "md",
    fullWidth: true,
  });

  return (
    <ModalShell
      onClose={onClose}
      ariaLabel={ariaLabel}
      overlayClassName={`z-[80] bg-slate-950/86 p-2 backdrop-blur-sm sm:p-4 ${className}`}
      panelClassName="grid h-[calc(100svh-1rem)] max-h-[calc(100svh-1rem)] w-full max-w-[calc(100vw-1rem)] min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,42svh)] overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-[#0f1726] sm:h-[calc(100svh-2rem)] sm:max-h-[calc(100svh-2rem)] sm:max-w-[calc(100vw-2rem)] lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] lg:grid-rows-1 xl:max-w-[92rem] animate-spring-pop-in"
    >
        <ZoomableImage
          src={imageUrl}
          alt={imageAlt}
          zoomOutLabel={t("imagePreview.zoomOut")}
          zoomInLabel={t("imagePreview.zoomIn")}
          resetLabel={t("imagePreview.reset")}
          interactive={imageInteractive}
          className="bg-slate-950"
        />
        <aside className="flex min-h-0 flex-col border-t border-slate-200 dark:border-slate-800 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-950 dark:text-white">{title}</div>
              {subtitle ? <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</div> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className={closeActionClassName}
              aria-label={closeLabel}
              title={closeLabel}
            >
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-200">{body}</div>
            {metadataRows.length ? (
              <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                {metadataRows.map((row) => (
                  <div key={row.label} className="min-w-0">
                    <div className="font-semibold text-slate-400 dark:text-slate-500">{row.label}</div>
                    <div className="mt-1 truncate font-medium text-slate-800 dark:text-slate-200">{row.value}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {providerNotes.length ? (
              <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{providerNotesTitle}</div>
                <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {providerNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="space-y-2 border-t border-slate-200 p-4 dark:border-slate-800">
            {footerExtra}
            <a
              href={api.toApiUrl(downloadUrl)}
              target="_blank"
              rel="noreferrer"
              className={downloadActionClassName}
            >
              <Download size={16} className="mr-2" />
              {downloadLabel}
            </a>
          </div>
        </aside>
    </ModalShell>
  );
}
