import { Children, isValidElement, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Columns2, Eye, Maximize2, PencilLine, X } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { isMermaidCodeLanguage, markdownHasVisibleContent } from "../lib/markdown";
import { useI18n, usePreferences } from "../lib/preferences";

type MarkdownViewMode = "edit" | "preview";
type MarkdownDialogMode = "edit" | "preview" | "split";
type MermaidRenderState =
  | { status: "rendering" }
  | { status: "rendered"; svg: string }
  | { status: "failed"; error: string };

interface MarkdownEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  modalTitle: string;
  placeholder?: string;
  helpText?: string;
  maxLength?: number;
  minRows?: number;
  disabled?: boolean;
  required?: boolean;
}

interface MarkdownTextAreaProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  minRows?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

const INLINE_PANEL_CLASS_NAME =
  "rounded-xl border border-slate-200 bg-white/80 shadow-sm dark:border-slate-700 dark:bg-[#0b1220]";
const SEGMENT_BUTTON_CLASS_NAME =
  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors";

function textFromChildren(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => (typeof child === "string" || typeof child === "number" ? String(child) : ""))
    .join("");
}

function safeMermaidId(id: string): string {
  return `mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function isExternalUrl(value: string | undefined): boolean {
  return Boolean(value && /^(https?:)?\/\//i.test(value));
}

function hasMermaidDiagramChild(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => isValidElement(child) && child.type === MermaidDiagram);
}

function modeButtonClassName(active: boolean): string {
  return active
    ? `${SEGMENT_BUTTON_CLASS_NAME} bg-slate-950 text-white shadow-sm dark:bg-slate-100 dark:text-slate-950`
    : `${SEGMENT_BUTTON_CLASS_NAME} text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white`;
}

function MarkdownTextArea({
  id,
  value,
  onChange,
  placeholder,
  maxLength,
  minRows = 6,
  disabled,
  className = "",
  ariaLabel,
}: MarkdownTextAreaProps) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      rows={minRows}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`w-full resize-y px-3 py-2 text-sm leading-6 outline-none textarea-premium disabled:cursor-not-allowed disabled:opacity-70 ${className}`}
    />
  );
}

function MermaidDiagram({ source }: { source: string }) {
  const { t } = useI18n();
  const { resolvedTheme } = usePreferences();
  const rawId = useId();
  const diagramId = useMemo(() => safeMermaidId(rawId), [rawId]);
  const [renderState, setRenderState] = useState<MermaidRenderState>({ status: "rendering" });

  useEffect(() => {
    const diagramSource = source.trim();
    let active = true;
    setRenderState({ status: "rendering" });
    if (!diagramSource) {
      setRenderState({ status: "failed", error: t("markdown.mermaidEmpty") });
      return () => {
        active = false;
      };
    }
    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolvedTheme === "dark" ? "dark" : "default",
        });
        const result = await mermaid.render(diagramId, diagramSource);
        if (active) {
          setRenderState({ status: "rendered", svg: result.svg });
        }
      } catch (error) {
        if (active) {
          setRenderState({
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    void renderDiagram();
    return () => {
      active = false;
    };
  }, [diagramId, resolvedTheme, source, t]);

  if (renderState.status === "rendering") {
    return (
      <div className="my-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300">
        {t("markdown.mermaidRendering")}
      </div>
    );
  }

  if (renderState.status === "failed") {
    return (
      <div className="my-3 overflow-hidden rounded-xl border border-red-200 bg-red-50 dark:border-red-400/35 dark:bg-red-500/10">
        <div className="border-b border-red-100 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-400/20 dark:text-red-100">
          {t("markdown.mermaidFailed")}
        </div>
        <div className="px-3 py-2 text-xs leading-5 text-red-700/85 dark:text-red-100/85">
          {renderState.error}
        </div>
        <pre className="max-h-64 overflow-auto border-t border-red-100 bg-white/70 p-3 text-xs leading-5 text-red-900 dark:border-red-400/20 dark:bg-slate-950/70 dark:text-red-100">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="my-3 overflow-auto rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/70">
      <div
        className="min-w-max [&_svg]:h-auto [&_svg]:max-w-none"
        // Mermaid returns SVG after strict Mermaid rendering. Raw markdown HTML remains disabled.
        dangerouslySetInnerHTML={{ __html: renderState.svg }}
      />
    </div>
  );
}

function MarkdownPreview({ value }: { value: string }) {
  const { t } = useI18n();

  if (!markdownHasVisibleContent(value)) {
    return (
      <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/45 dark:text-slate-400">
        {t("markdown.emptyPreview")}
      </div>
    );
  }

  const components: Components = {
    h1: ({ children }) => <h1 className="mb-3 mt-1 text-2xl font-semibold leading-tight text-slate-950 dark:text-white">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-2.5 mt-5 text-xl font-semibold leading-tight text-slate-950 dark:text-white">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold leading-tight text-slate-900 dark:text-slate-100">{children}</h3>,
    p: ({ children }) => <p className="my-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700 dark:text-slate-200">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-700 dark:text-slate-200">{children}</ol>,
    li: ({ children }) => <li className="pl-1">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-4 border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm text-slate-700 dark:border-violet-400/35 dark:bg-violet-500/10 dark:text-slate-200">
        {children}
      </blockquote>
    ),
    a: ({ children, href }) => (
      <a
        href={href}
        target={isExternalUrl(href) ? "_blank" : undefined}
        rel={isExternalUrl(href) ? "noreferrer noopener" : undefined}
        className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-violet-300"
      >
        {children}
      </a>
    ),
    code: ({ children, className, ...props }) => {
      const codeText = textFromChildren(children).replace(/\n$/, "");
      if (isMermaidCodeLanguage(className)) {
        return <MermaidDiagram source={codeText} />;
      }
      const codeProps = { ...props };
      delete (codeProps as { node?: unknown }).node;
      return (
        <code
          {...codeProps}
          className={`rounded-md bg-slate-100 px-1.5 py-0.5 text-[0.92em] text-slate-800 dark:bg-slate-800 dark:text-slate-100 ${className ?? ""}`}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }) =>
      hasMermaidDiagramChild(children) ? (
        <>{children}</>
      ) : (
        <pre className="my-3 overflow-x-auto rounded-xl border border-slate-200 bg-slate-950 p-3 text-xs leading-5 text-slate-100 dark:border-slate-700 dark:bg-slate-950">
          {children}
        </pre>
      ),
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-slate-50 dark:bg-slate-900">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">{children}</tbody>,
    th: ({ children }) => <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">{children}</th>,
    td: ({ children }) => <td className="px-3 py-2 text-sm text-slate-700 dark:text-slate-200">{children}</td>,
    hr: () => <hr className="my-4 border-slate-200 dark:border-slate-700" />,
  };

  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {value}
      </ReactMarkdown>
    </div>
  );
}

function ModeButtons({
  mode,
  onModeChange,
}: {
  mode: MarkdownViewMode;
  onModeChange: (mode: MarkdownViewMode) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
      <button type="button" onClick={() => onModeChange("edit")} className={modeButtonClassName(mode === "edit")}>
        <PencilLine size={13} />
        {t("markdown.edit")}
      </button>
      <button type="button" onClick={() => onModeChange("preview")} className={modeButtonClassName(mode === "preview")}>
        <Eye size={13} />
        {t("markdown.preview")}
      </button>
    </div>
  );
}

function DialogModeButtons({
  mode,
  onModeChange,
}: {
  mode: MarkdownDialogMode;
  onModeChange: (mode: MarkdownDialogMode) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
      <button type="button" onClick={() => onModeChange("edit")} className={modeButtonClassName(mode === "edit")}>
        <PencilLine size={13} />
        {t("markdown.edit")}
      </button>
      <button type="button" onClick={() => onModeChange("preview")} className={modeButtonClassName(mode === "preview")}>
        <Eye size={13} />
        {t("markdown.preview")}
      </button>
      <button type="button" onClick={() => onModeChange("split")} className={modeButtonClassName(mode === "split")}>
        <Columns2 size={13} />
        {t("markdown.split")}
      </button>
    </div>
  );
}

export function MarkdownEditor({
  label,
  value,
  onChange,
  modalTitle,
  placeholder,
  helpText,
  maxLength,
  minRows = 6,
  disabled,
  required,
}: MarkdownEditorProps) {
  const { t } = useI18n();
  const labelId = useId();
  const dialogTitleId = useId();
  const inlineTextareaId = useId();
  const dialogTextareaId = useId();
  const [viewMode, setViewMode] = useState<MarkdownViewMode>("edit");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<MarkdownDialogMode>("split");
  const characterCount = maxLength ? t("markdown.characterCount", { count: value.length, max: maxLength }) : null;

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDialogOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialogOpen]);

  const preview = <MarkdownPreview value={value} />;
  const editor = (
    <MarkdownTextArea
      id={inlineTextareaId}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      minRows={minRows}
      disabled={disabled}
      ariaLabel={label}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label id={labelId} htmlFor={inlineTextareaId} className="text-sm font-medium text-zinc-700 dark:text-slate-300">
          {label} {required ? <span className="text-red-500">*</span> : null}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <ModeButtons mode={viewMode} onModeChange={setViewMode} />
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={disabled}
            className="btn-secondary-spring inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold disabled:cursor-not-allowed"
            aria-label={t("markdown.openLargeEditor")}
            title={t("markdown.openLargeEditor")}
          >
            <Maximize2 size={13} />
            {t("markdown.open")}
          </button>
        </div>
      </div>
      <div className={INLINE_PANEL_CLASS_NAME}>
        <div className={viewMode === "edit" ? "block" : "hidden"}>{editor}</div>
        <div className={viewMode === "preview" ? "max-h-96 overflow-auto p-3" : "hidden"}>{preview}</div>
      </div>
      <div className="flex items-start justify-between gap-3 text-xs text-zinc-400 dark:text-slate-500">
        {helpText ? <span>{helpText}</span> : <span>{t("markdown.markdownHelp")}</span>}
        {characterCount ? <span className="shrink-0">{characterCount}</span> : null}
      </div>

      {dialogOpen && typeof document !== "undefined" ? createPortal(
        <div
          data-vaul-no-drag
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDialogOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="flex h-[94dvh] max-h-[94dvh] w-[min(96vw,1560px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/25 animate-spring-pop-in dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/50"
          >
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <h2 id={dialogTitleId} className="truncate text-base font-semibold text-slate-950 dark:text-white">
                  {modalTitle}
                </h2>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("markdown.dialogDescription")}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DialogModeButtons mode={dialogMode} onModeChange={setDialogMode} />
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="btn-secondary-spring inline-flex h-9 w-9 items-center justify-center rounded-xl"
                  aria-label={t("markdown.closeLargeEditor")}
                  title={t("markdown.closeLargeEditor")}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div
              className={`min-h-0 flex-1 gap-4 overflow-hidden p-4 ${
                dialogMode === "split" ? "grid md:grid-cols-2" : "block"
              }`}
            >
              <section className={dialogMode === "preview" ? "hidden" : "flex h-full min-h-0 min-w-0 flex-col gap-2"}>
                <label htmlFor={dialogTextareaId} className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  {t("markdown.source")}
                </label>
                <MarkdownTextArea
                  id={dialogTextareaId}
                  value={value}
                  onChange={onChange}
                  placeholder={placeholder}
                  maxLength={maxLength}
                  minRows={18}
                  disabled={disabled}
                  className="min-h-0 flex-1"
                  ariaLabel={label}
                />
              </section>
              <section className={dialogMode === "edit" ? "hidden" : "h-full min-h-0 min-w-0 overflow-auto rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-950/45"}>
                <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
                  {t("markdown.renderedPreview")}
                </div>
                {preview}
              </section>
            </div>
            {characterCount ? (
              <div className="border-t border-slate-100 px-4 py-2 text-right text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                {characterCount}
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
