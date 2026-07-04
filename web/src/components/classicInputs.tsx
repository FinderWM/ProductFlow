import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import {
  assignInputRef,
  inputClassNames,
  resizeTextareaToFit,
  type InputCheckboxSize,
  type InputCheckboxVariant,
  type InputFieldSize,
  type InputOptionToggleLayout,
  type InputTextareaVariant,
} from "./inputControlUtils";
import { SelectField, type SelectFieldProps } from "./SelectField";

interface ClassicTextInputClassNameOptions {
  size?: InputFieldSize;
  className?: string;
}

interface ClassicTextareaClassNameOptions {
  size?: InputFieldSize;
  variant?: InputTextareaVariant;
  autosize?: boolean;
  className?: string;
}

const CLASSIC_TEXT_INPUT_BASE_CLASS = "input-premium w-full disabled:cursor-not-allowed disabled:opacity-60";

const CLASSIC_TEXTAREA_BASE_CLASS = "textarea-premium w-full disabled:cursor-not-allowed disabled:opacity-60";

const CLASSIC_INPUT_SIZE_CLASS_NAMES: Record<InputFieldSize, string> = {
  compact: "h-9 px-3 text-xs",
  default: "h-10 px-3.5 text-sm",
  tall: "h-11 px-4 text-sm",
};

const CLASSIC_TEXTAREA_SIZE_CLASS_NAMES: Record<InputFieldSize, string> = {
  compact: "px-3 py-2.5 text-xs leading-5",
  default: "px-4 py-3 text-sm leading-6",
  tall: "px-4 py-3.5 text-sm leading-6",
};

const CLASSIC_SELECT_BUTTON_SIZE_CLASS_NAMES: Record<InputFieldSize, string> = {
  compact: "h-9 pl-2.5 pr-9 text-xs",
  default: "h-10 pl-3 pr-10 text-sm",
  tall: "h-11 pl-4 pr-10 text-sm",
};

const CLASSIC_SELECT_SEARCH_INPUT_SIZE_CLASS_NAMES: Record<InputFieldSize, string> = {
  compact: "h-8 pl-7 pr-8 text-xs",
  default: "h-9 pl-8 pr-9 text-sm",
  tall: "h-10 pl-8 pr-9 text-sm",
};

export function classicTextInputClassName({
  size = "default",
  className,
}: ClassicTextInputClassNameOptions = {}) {
  return inputClassNames(CLASSIC_TEXT_INPUT_BASE_CLASS, CLASSIC_INPUT_SIZE_CLASS_NAMES[size], className);
}

export function classicTextareaClassName({
  size = "default",
  variant = "default",
  autosize = false,
  className,
}: ClassicTextareaClassNameOptions = {}) {
  return inputClassNames(
    CLASSIC_TEXTAREA_BASE_CLASS,
    CLASSIC_TEXTAREA_SIZE_CLASS_NAMES[size],
    autosize ? "resize-none" : "resize-y",
    variant === "prompt" ? "pf-settings-prompt-textarea" : null,
    className,
  );
}

export interface ClassicTextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: InputFieldSize;
}

export const ClassicTextInput = forwardRef<HTMLInputElement, ClassicTextInputProps>(function ClassicTextInput(
  { size = "default", className, ...props },
  ref,
) {
  return <input {...props} ref={ref} className={classicTextInputClassName({ size, className })} />;
});

export interface ClassicTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: InputFieldSize;
  variant?: InputTextareaVariant;
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
}

export const ClassicTextarea = forwardRef<HTMLTextAreaElement, ClassicTextareaProps>(function ClassicTextarea(
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (!autosize) {
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    resizeTextareaToFit(textarea, minRows, maxRows);
  }, [autosize, maxRows, minRows, value]);

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
      className={classicTextareaClassName({ size, variant, autosize, className })}
    />
  );
});

export interface ClassicSelectFieldProps extends SelectFieldProps {
  size?: InputFieldSize;
}

export function ClassicSelectField({
  size,
  radius = "xl",
  visualSize,
  buttonClassName,
  searchInputClassName,
  ...props
}: ClassicSelectFieldProps) {
  const resolvedSize = size ?? (visualSize === "sm" ? "compact" : "default");
  return (
    <SelectField
      {...props}
      radius={radius}
      visualSize={visualSize ?? (resolvedSize === "compact" ? "sm" : "md")}
      buttonClassName={inputClassNames(CLASSIC_SELECT_BUTTON_SIZE_CLASS_NAMES[resolvedSize], buttonClassName)}
      searchInputClassName={inputClassNames(
        CLASSIC_SELECT_SEARCH_INPUT_SIZE_CLASS_NAMES[resolvedSize],
        searchInputClassName,
      )}
    />
  );
}

export interface ClassicCheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  size?: InputCheckboxSize;
  variant?: InputCheckboxVariant;
  label?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  wrapperClassName?: string;
  controlClassName?: string;
}

export function ClassicCheckbox({
  size = "md",
  variant = "inline",
  label,
  description,
  children,
  wrapperClassName,
  controlClassName,
  disabled = false,
  ...props
}: ClassicCheckboxProps) {
  const content = children ?? label;
  const wrapperClassNameValue =
    variant === "card"
      ? "flex items-start gap-2 rounded-xl border pf-hairline pf-surface px-3 py-2 text-xs font-medium pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#111b2d] dark:text-[color:var(--pf-muted)]"
      : "inline-flex items-start gap-2 text-sm font-medium pf-ink-muted dark:text-[color:var(--pf-muted)]";
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

export interface ClassicOptionToggleProps {
  checked: boolean;
  disabled?: boolean;
  inputId?: string;
  name?: string;
  title?: string;
  children: ReactNode;
  layout?: InputOptionToggleLayout;
  selectionMode?: "multiple" | "single";
  className?: string;
  onChange: (checked: boolean) => void;
}

export function ClassicOptionToggle({
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
}: ClassicOptionToggleProps) {
  return (
    <label
      className={inputClassNames(
        "pf-settings-option-toggle border transition-all",
        layout === "card"
          ? "flex min-h-10 max-w-full items-start gap-2 rounded-xl py-2 pl-2.5 pr-3 text-sm"
          : "inline-flex min-h-9 max-w-full items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3 text-xs font-medium",
        checked
          ? "border-[color:var(--pf-border)] pf-surface-soft pf-ink dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-border-soft)] dark:text-[#fff]"
          : "pf-hairline pf-surface-soft pf-ink-muted hover:border-[color:var(--pf-border)] hover:bg-[#fff] hover:text-[color:var(--pf-text)] dark:border-[color:var(--pf-border)] dark:bg-[#111b2d] dark:text-[color:var(--pf-muted)] dark:hover:border-[color:var(--pf-border)] dark:hover:bg-[#15233a] dark:hover:text-[#fff]",
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

export interface ClassicSwitchProps {
  checked: boolean;
  disabled?: boolean;
  inputId?: string;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  controlClassName?: string;
  controlContent?: ReactNode;
  onChange: (checked: boolean) => void;
}

export function ClassicSwitch({
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
}: ClassicSwitchProps) {
  return (
    <label
      className={inputClassNames(
        "pf-settings-switch-toggle inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border py-1.5 pl-3 pr-2 text-xs font-semibold transition-all",
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
