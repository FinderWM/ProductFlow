import { useId, useState, type ReactNode } from "react";
import { CircleHelp, X } from "lucide-react";

import {
  isStaticParameterHelpKey,
  PARAMETER_HELP_BASE_UI_CLASS_NAMES,
  PARAMETER_HELP_REGISTRY,
  PARAMETER_HELP_UI_CLASS_REGISTRY,
  type ParameterHelpKey,
  type ParameterHelpUiClassNames,
  type ParameterHelpUiType,
} from "../lib/parameterHelp";
import { useI18n } from "../lib/preferences";
import { ModalShell } from "./ModalShell";

export interface ParameterHelpContentOverride {
  title?: string;
  description?: string;
  examples?: string[];
}

interface ResolvedParameterHelpContent {
  title: string;
  description: string;
  examples: string[];
}

interface ParameterHelpButtonProps {
  helpKey: ParameterHelpKey;
  uiType?: ParameterHelpUiType;
  content?: ParameterHelpContentOverride;
  className?: string;
}

interface ParameterHelpDialogProps {
  helpKey: ParameterHelpKey;
  uiType: ParameterHelpUiType;
  content?: ParameterHelpContentOverride;
  onClose: () => void;
}

interface ParameterHelpLabelProps {
  label: ReactNode;
  helpKey: ParameterHelpKey;
  uiType?: ParameterHelpUiType;
  content?: ParameterHelpContentOverride;
  className?: string;
}

function mergeClassNames(...classNames: Array<string | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

function parseExamples(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveClassNames(helpKey: ParameterHelpKey, uiType: ParameterHelpUiType): ParameterHelpUiClassNames {
  const entry = isStaticParameterHelpKey(helpKey) ? PARAMETER_HELP_REGISTRY[helpKey] : null;
  const uiTypeClassNames = PARAMETER_HELP_UI_CLASS_REGISTRY[uiType];
  const entryClassNames = entry?.uiClassNames?.[uiType] ?? {};
  return {
    button: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.button, uiTypeClassNames.button, entryClassNames.button),
    overlay: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.overlay, uiTypeClassNames.overlay, entryClassNames.overlay),
    panel: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.panel, uiTypeClassNames.panel, entryClassNames.panel),
    header: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.header, uiTypeClassNames.header, entryClassNames.header),
    icon: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.icon, uiTypeClassNames.icon, entryClassNames.icon),
    eyebrow: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.eyebrow, uiTypeClassNames.eyebrow, entryClassNames.eyebrow),
    title: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.title, uiTypeClassNames.title, entryClassNames.title),
    closeButton: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.closeButton, uiTypeClassNames.closeButton, entryClassNames.closeButton),
    body: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.body, uiTypeClassNames.body, entryClassNames.body),
    sectionTitle: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.sectionTitle, uiTypeClassNames.sectionTitle, entryClassNames.sectionTitle),
    intro: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.intro, uiTypeClassNames.intro, entryClassNames.intro),
    example: mergeClassNames(PARAMETER_HELP_BASE_UI_CLASS_NAMES.example, uiTypeClassNames.example, entryClassNames.example),
  };
}

function resolveContent(
  helpKey: ParameterHelpKey,
  t: ReturnType<typeof useI18n>["t"],
  content?: ParameterHelpContentOverride,
): ResolvedParameterHelpContent | null {
  if (content?.title && content.description) {
    return {
      title: content.title,
      description: content.description,
      examples: content.examples ?? [],
    };
  }
  if (!isStaticParameterHelpKey(helpKey)) {
    return null;
  }
  const entry = PARAMETER_HELP_REGISTRY[helpKey];
  return {
    title: content?.title ?? t(entry.titleKey),
    description: content?.description ?? t(entry.introKey),
    examples: content?.examples ?? parseExamples(t(entry.examplesKey)),
  };
}

export function ParameterHelpButton({
  helpKey,
  uiType = "default",
  content,
  className = "",
}: ParameterHelpButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const classes = resolveClassNames(helpKey, uiType);
  const title = t("detail.parameterHelp.tooltip");
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className={mergeClassNames(classes.button, className)}
        aria-label={title}
        title={title}
      >
        <CircleHelp size={13} strokeWidth={2.2} />
      </button>
      {open ? (
        <ParameterHelpDialog helpKey={helpKey} uiType={uiType} content={content} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export function ParameterHelpLabel({
  label,
  helpKey,
  uiType = "default",
  content,
  className = "",
}: ParameterHelpLabelProps) {
  return (
    <span className={mergeClassNames("inline-flex w-fit max-w-full min-w-0 items-center gap-1.5", className)}>
      <span className="min-w-0 truncate">{label}</span>
      <ParameterHelpButton helpKey={helpKey} uiType={uiType} content={content} />
    </span>
  );
}

function ParameterHelpDialog({ helpKey, uiType, content, onClose }: ParameterHelpDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const classes = resolveClassNames(helpKey, uiType);
  const resolved = resolveContent(helpKey, t, content);

  if (!resolved) {
    return null;
  }

  return (
    <ModalShell
      onClose={onClose}
      closeOnBackdrop={false}
      ariaLabelledBy={titleId}
      overlayClassName={classes.overlay}
      panelClassName={classes.panel}
    >
        <div className={classes.header}>
          <div className={classes.icon}>
            <CircleHelp size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className={classes.eyebrow}>{t("detail.parameterHelp.header")}</div>
            <h2 id={titleId} className={classes.title}>
              {resolved.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={classes.closeButton}
            aria-label={t("detail.parameterHelp.close")}
            title={t("detail.parameterHelp.close")}
          >
            <X size={16} />
          </button>
        </div>
        <div className={classes.body}>
          <section>
            <h3 className={classes.sectionTitle}>{t("detail.parameterHelp.descriptionTitle")}</h3>
            <p className={classes.intro}>{resolved.description}</p>
          </section>
          {resolved.examples.length ? (
            <section className="mt-5">
              <h3 className={classes.sectionTitle}>{t("detail.parameterHelp.examplesTitle")}</h3>
              <ul className="mt-2 space-y-2">
                {resolved.examples.map((example) => (
                  <li key={example} className={classes.example}>
                    {example}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
    </ModalShell>
  );
}
