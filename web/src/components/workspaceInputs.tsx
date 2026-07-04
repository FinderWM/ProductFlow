import {
  forwardRef,
  useLayoutEffect,
  useRef,
} from "react";

import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import {
  ClassicCheckbox,
  ClassicOptionToggle,
  ClassicSelectField,
  ClassicSwitch,
  ClassicTextInput,
  ClassicTextarea,
  type ClassicCheckboxProps,
  type ClassicOptionToggleProps,
  type ClassicSelectFieldProps,
  type ClassicSwitchProps,
  type ClassicTextInputProps,
  type ClassicTextareaProps,
} from "./classicInputs";
import {
  assignInputRef,
  inputClassNames,
  resizeTextareaToFit,
  type InputCheckboxVariant,
  type InputFieldSize,
  type InputOptionToggleLayout,
  type InputTextareaVariant,
} from "./inputControlUtils";
import { SelectField } from "./SelectField";

export type WorkspaceFieldSize = InputFieldSize;
export type WorkspaceTextareaVariant = InputTextareaVariant;
export type WorkspaceOptionToggleLayout = InputOptionToggleLayout;
export type WorkspaceCheckboxVariant = InputCheckboxVariant;

interface WorkspaceTextInputClassNameOptions {
  size?: WorkspaceFieldSize;
  className?: string;
}

interface WorkspaceTextareaClassNameOptions {
  size?: WorkspaceFieldSize;
  variant?: WorkspaceTextareaVariant;
  autosize?: boolean;
  className?: string;
}

const WORKSPACE_TEXT_INPUT_BASE_CLASS =
  "pf-workspace-field w-full rounded-xl border pf-hairline pf-surface-soft pf-ink " +
  "placeholder:text-[color:var(--pf-muted)] shadow-none transition-colors focus:border-indigo-500 focus:bg-[#fff] " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 " +
  "dark:border-[color:var(--pf-border)] dark:bg-[#111b2d] dark:text-[color:var(--pf-muted)] dark:placeholder:text-[color:var(--pf-muted)] " +
  "dark:focus:border-violet-400 dark:focus:bg-[#111b2d] dark:focus:ring-violet-400/20";

const WORKSPACE_TEXTAREA_BASE_CLASS =
  "pf-workspace-field pf-workspace-textarea w-full rounded-xl border pf-hairline pf-surface-soft pf-ink " +
  "placeholder:text-[color:var(--pf-muted)] shadow-none transition-colors focus:border-indigo-500 focus:bg-[#fff] " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60 " +
  "dark:border-[color:var(--pf-border)] dark:bg-[#111b2d] dark:text-[color:var(--pf-muted)] dark:placeholder:text-[color:var(--pf-muted)] " +
  "dark:focus:border-violet-400 dark:focus:bg-[#111b2d] dark:focus:ring-violet-400/20";

const WORKSPACE_INPUT_SIZE_CLASS_NAMES: Record<WorkspaceFieldSize, string> = {
  compact: "h-9 px-3 text-xs",
  default: "h-10 px-3.5 text-sm",
  tall: "h-11 px-4 text-sm",
};

const WORKSPACE_TEXTAREA_SIZE_CLASS_NAMES: Record<WorkspaceFieldSize, string> = {
  compact: "px-3 py-2.5 text-xs leading-5",
  default: "px-4 py-3 text-sm leading-6",
  tall: "px-4 py-3.5 text-sm leading-6",
};

const WORKSPACE_SELECT_BUTTON_SIZE_CLASS_NAMES: Record<WorkspaceFieldSize, string> = {
  compact: "h-9 pl-2.5 pr-9 text-xs",
  default: "h-10 pl-3.5 pr-10 text-sm",
  tall: "h-11 pl-4 pr-10 text-sm",
};

const WORKSPACE_SELECT_SEARCH_INPUT_SIZE_CLASS_NAMES: Record<WorkspaceFieldSize, string> = {
  compact: "h-8 pl-7 pr-8 text-xs",
  default: "h-9 pl-8 pr-9 text-sm",
  tall: "h-10 pl-8 pr-9 text-sm",
};

function useWorkspaceInputScheme() {
  const { activeScheme } = useUiLayoutScheme();
  return activeScheme === "workspace";
}

export function workspaceTextInputClassName({
  size = "default",
  className,
}: WorkspaceTextInputClassNameOptions = {}) {
  return inputClassNames(WORKSPACE_TEXT_INPUT_BASE_CLASS, WORKSPACE_INPUT_SIZE_CLASS_NAMES[size], className);
}

export function workspaceTextareaClassName({
  size = "default",
  variant = "default",
  autosize = false,
  className,
}: WorkspaceTextareaClassNameOptions = {}) {
  return inputClassNames(
    WORKSPACE_TEXTAREA_BASE_CLASS,
    WORKSPACE_TEXTAREA_SIZE_CLASS_NAMES[size],
    autosize ? "resize-none" : "resize-y",
    variant === "prompt" ? "pf-settings-prompt-textarea" : null,
    className,
  );
}

export type WorkspaceTextInputProps = ClassicTextInputProps;

export const WorkspaceTextInput = forwardRef<HTMLInputElement, WorkspaceTextInputProps>(function WorkspaceTextInput(
  { size = "default", className, ...props },
  ref,
) {
  const isWorkspaceScheme = useWorkspaceInputScheme();
  if (!isWorkspaceScheme) {
    return <ClassicTextInput {...props} ref={ref} size={size} className={className} />;
  }
  return (
    <input
      {...props}
      ref={ref}
      className={workspaceTextInputClassName({ size, className })}
    />
  );
});

export type WorkspaceTextareaProps = ClassicTextareaProps;

export const WorkspaceTextarea = forwardRef<HTMLTextAreaElement, WorkspaceTextareaProps>(function WorkspaceTextarea(
  {
    size = "default",
    variant = "default",
    autosize = false,
    minRows = 3,
    maxRows,
    rows,
    className,
    style,
    value,
    ...props
  },
  ref,
) {
  const isWorkspaceScheme = useWorkspaceInputScheme();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (!isWorkspaceScheme || !autosize) {
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    resizeTextareaToFit(textarea, minRows, maxRows);
  }, [autosize, isWorkspaceScheme, maxRows, minRows, value]);

  if (!isWorkspaceScheme) {
    return (
      <ClassicTextarea
        {...props}
        ref={ref}
        size={size}
        variant={variant}
        autosize={autosize}
        minRows={minRows}
        maxRows={maxRows}
        rows={rows}
        className={className}
        style={style}
        value={value}
      />
    );
  }

  return (
    <textarea
      {...props}
      ref={(node) => {
        textareaRef.current = node;
        assignInputRef(ref, node);
      }}
      rows={rows ?? minRows}
      value={value}
      style={style}
      className={workspaceTextareaClassName({ size, variant, autosize, className })}
    />
  );
});

export type WorkspaceSelectFieldProps = ClassicSelectFieldProps;

export function WorkspaceSelectField({
  size,
  radius = "xl",
  visualSize,
  buttonClassName,
  surfaceClassName,
  searchInputClassName,
  ...props
}: WorkspaceSelectFieldProps) {
  const isWorkspaceScheme = useWorkspaceInputScheme();
  if (!isWorkspaceScheme) {
    return (
      <ClassicSelectField
        {...props}
        size={size}
        radius={radius}
        visualSize={visualSize}
        buttonClassName={buttonClassName}
        surfaceClassName={surfaceClassName}
        searchInputClassName={searchInputClassName}
      />
    );
  }
  const resolvedSize = size ?? (visualSize === "sm" ? "compact" : "default");
  return (
    <SelectField
      {...props}
      radius={radius}
      visualSize={visualSize ?? (resolvedSize === "compact" ? "sm" : "md")}
      buttonClassName={inputClassNames(
        WORKSPACE_SELECT_BUTTON_SIZE_CLASS_NAMES[resolvedSize],
        buttonClassName,
      )}
      surfaceClassName={inputClassNames("pf-workspace-select-surface", surfaceClassName)}
      searchInputClassName={inputClassNames(
        WORKSPACE_SELECT_SEARCH_INPUT_SIZE_CLASS_NAMES[resolvedSize],
        searchInputClassName,
      )}
    />
  );
}

export type WorkspaceCheckboxProps = ClassicCheckboxProps;

export function WorkspaceCheckbox({
  size = "md",
  variant = "inline",
  label,
  description,
  children,
  wrapperClassName,
  controlClassName,
  disabled = false,
  ...props
}: WorkspaceCheckboxProps) {
  const isWorkspaceScheme = useWorkspaceInputScheme();
  if (!isWorkspaceScheme) {
    return (
      <ClassicCheckbox
        {...props}
        size={size}
        variant={variant}
        label={label}
        description={description}
        wrapperClassName={wrapperClassName}
        controlClassName={controlClassName}
        disabled={disabled}
      >
        {children}
      </ClassicCheckbox>
    );
  }
  const content = children ?? label;
  const wrapperClassNameValue =
    variant === "card"
      ? "pf-workspace-input-scope flex items-start gap-2 rounded-xl border pf-hairline pf-surface-soft px-3 py-2 text-xs font-medium pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]"
      : "pf-workspace-input-scope inline-flex items-start gap-2 text-sm font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]";
  const controlSizeClassName = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <label
      className={inputClassNames(
        wrapperClassNameValue,
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        wrapperClassName,
      )}
    >
      <input
        {...props}
        type="checkbox"
        disabled={disabled}
        className={inputClassNames(
          "pf-checkbox mt-0.5 shrink-0 rounded pf-hairline-strong dark:border-[color:var(--pf-border)]",
          controlSizeClassName,
          controlClassName,
        )}
      />
      {content || description ? (
        <span className="min-w-0">
          {content ? <span className="block leading-5">{content}</span> : null}
          {description ? (
            <span className="mt-1 block text-xs font-normal leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}

export type WorkspaceOptionToggleProps = ClassicOptionToggleProps;

export function WorkspaceOptionToggle({
  checked,
  disabled = false,
  inputId,
  name,
  title,
  children,
  layout = "pill",
  selectionMode = "multiple",
  className,
  onChange,
}: WorkspaceOptionToggleProps) {
  const isWorkspaceScheme = useWorkspaceInputScheme();
  if (!isWorkspaceScheme) {
    return (
      <ClassicOptionToggle
        checked={checked}
        disabled={disabled}
        inputId={inputId}
        name={name}
        title={title}
        layout={layout}
        selectionMode={selectionMode}
        className={className}
        onChange={onChange}
      >
        {children}
      </ClassicOptionToggle>
    );
  }
  return (
    <label
      className={inputClassNames(
        "pf-settings-option-toggle border transition-all",
        layout === "card"
          ? "flex min-h-10 max-w-full items-start gap-2 rounded-xl py-2 pl-2.5 pr-3 text-sm"
          : "inline-flex min-h-9 max-w-full items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3 text-xs font-medium",
        "pf-workspace-input-scope",
        checked
          ? "border-indigo-300 bg-indigo-50 pf-ink dark:border-violet-400/45 dark:bg-violet-500/14 dark:text-[#fff]"
          : "pf-hairline pf-surface pf-ink-muted hover:border-[color:var(--pf-border)] hover:bg-[color:var(--pf-panel-soft)] hover:text-[color:var(--pf-text)] dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)] dark:hover:border-[color:var(--pf-border)] dark:hover:bg-[color:var(--pf-deep)] dark:hover:text-[#fff]",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer active:scale-[0.99]",
        className,
      )}
      title={title}
    >
      <input
        id={inputId}
        type={selectionMode === "single" ? "radio" : "checkbox"}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className={inputClassNames("pf-settings-option-toggle-control", layout === "card" ? "mt-0.5" : null)} aria-hidden="true" />
      <span className="min-w-0 leading-5">{children}</span>
    </label>
  );
}

export type WorkspaceSwitchProps = ClassicSwitchProps;

export function WorkspaceSwitch({
  checked,
  disabled = false,
  inputId,
  children,
  className,
  ariaLabel,
  ariaDescribedBy,
  controlClassName,
  controlContent,
  onChange,
}: WorkspaceSwitchProps) {
  const isWorkspaceScheme = useWorkspaceInputScheme();
  if (!isWorkspaceScheme) {
    return (
      <ClassicSwitch
        checked={checked}
        disabled={disabled}
        inputId={inputId}
        className={className}
        ariaLabel={ariaLabel}
        ariaDescribedBy={ariaDescribedBy}
        controlClassName={controlClassName}
        controlContent={controlContent}
        onChange={onChange}
      >
        {children}
      </ClassicSwitch>
    );
  }
  return (
    <label
      className={inputClassNames(
        "pf-settings-switch-toggle inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border py-1.5 pl-3 pr-2 text-xs font-semibold transition-all",
        "pf-workspace-input-scope",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer active:scale-[0.99]",
        className,
      )}
    >
      {children ? <span className="min-w-0 leading-5">{children}</span> : null}
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className={inputClassNames("pf-settings-switch-control", controlClassName)} aria-hidden="true">
        {controlContent}
      </span>
    </label>
  );
}
