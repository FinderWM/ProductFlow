import { useEffect, useId, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { ClipboardPaste, X } from "lucide-react";

import { ModalShell } from "./ModalShell";

const CLIPBOARD_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface ClipboardImageButtonProps {
  buttonClassName: string;
  rootClassName?: string;
  dialogClassName?: string;
  inputClassName?: string;
  disabled?: boolean;
  multiple?: boolean;
  label: string;
  closeLabel: string;
  pasteAreaLabel: string;
  pasteAreaPlaceholder: string;
  noImageMessage: string;
  onFiles: (files: File[]) => void;
  onError?: (message: string) => void;
}

function clipboardImageFilename(mimeType: string, index: number): string {
  const extension = CLIPBOARD_IMAGE_EXTENSIONS[mimeType] ?? "png";
  return `clipboard-image-${Date.now()}-${index + 1}.${extension}`;
}

function normalizeClipboardImageFile(file: File, mimeType: string, index: number): File {
  const type = file.type || mimeType;
  if (file.name && file.type) {
    return file;
  }
  return new File([file], file.name || clipboardImageFilename(type, index), {
    type,
    lastModified: file.lastModified,
  });
}

function filesFromClipboardData(clipboardData: DataTransfer, multiple: boolean): File[] {
  const directFiles = Array.from(clipboardData.files)
    .filter((file) => file.type.startsWith("image/"))
    .map((file, index) => normalizeClipboardImageFile(file, file.type, index));
  if (directFiles.length) {
    return multiple ? directFiles : directFiles.slice(0, 1);
  }

  const files: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    files.push(normalizeClipboardImageFile(file, item.type, files.length));
    if (!multiple) {
      break;
    }
  }
  return files;
}

export function ClipboardImageButton({
  buttonClassName,
  rootClassName = "",
  dialogClassName = "",
  inputClassName = "",
  disabled = false,
  multiple = false,
  label,
  closeLabel,
  pasteAreaLabel,
  pasteAreaPlaceholder,
  noImageMessage,
  onFiles,
  onError,
}: ClipboardImageButtonProps) {
  const [open, setOpen] = useState(false);
  const pasteTargetRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const pasteTargetId = useId();

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      return;
    }
    if (open) {
      pasteTargetRef.current?.focus();
    }
  }, [disabled, open]);

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled) {
      return;
    }
    const files = filesFromClipboardData(event.clipboardData, multiple);
    event.preventDefault();
    event.currentTarget.value = "";
    if (!files.length) {
      onError?.(noImageMessage);
      return;
    }
    onFiles(files);
    setOpen(false);
  }

  const dialog = open ? (
    <ModalShell
      onClose={() => setOpen(false)}
      ariaLabelledBy={titleId}
      overlayClassName="z-[95] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      panelClassName={`w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in ${dialogClassName}`}
    >
        <div className="mb-3 flex items-center justify-between gap-3">
          <label id={titleId} htmlFor={pasteTargetId} className="text-sm font-semibold text-slate-950 dark:text-white">
            {label}
          </label>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-accent,#6366f1)]/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-[var(--pf-accent,#a78bfa)]/40"
            aria-label={closeLabel}
            title={closeLabel}
          >
            <X size={14} />
          </button>
        </div>
        <textarea
          id={pasteTargetId}
          ref={pasteTargetRef}
          aria-label={pasteAreaLabel}
          placeholder={pasteAreaPlaceholder}
          rows={4}
          className={`pf-textarea min-h-28 resize-none ${inputClassName}`}
          onPaste={handlePaste}
          onInput={(event) => {
            event.currentTarget.value = "";
          }}
        />
    </ModalShell>
  ) : null;

  return (
    <div className={rootClassName}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        className={buttonClassName}
        aria-label={label}
        aria-expanded={open}
        title={label}
      >
        <ClipboardPaste size={14} className="mr-2" />
        {label}
      </button>
      {dialog}
    </div>
  );
}
