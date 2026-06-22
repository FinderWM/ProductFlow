import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";

import { FloatingSurface } from "./FloatingSurface";

export interface SelectFieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldGroup {
  label: string;
  options: SelectFieldOption[];
}

interface SelectFieldProps {
  id?: string;
  value: string;
  options?: readonly SelectFieldOption[];
  groups?: readonly SelectFieldGroup[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  radius?: "lg" | "xl";
  visualSize?: "sm" | "md";
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  searchLoading?: boolean;
  searchLoadingLabel?: string;
  emptyLabel?: string;
}

interface FlatOption extends SelectFieldOption {
  groupLabel?: string;
}

export function SelectField({
  id,
  value,
  options = [],
  groups = [],
  onChange,
  ariaLabel,
  className = "",
  disabled = false,
  radius = "xl",
  visualSize = "md",
  searchValue = "",
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  searchLoading = false,
  searchLoadingLabel,
  emptyLabel,
}: SelectFieldProps) {
  const generatedId = useId();
  const buttonId = id ?? generatedId;
  const listboxId = `${buttonId}-listbox`;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(value);
  const searchable = Boolean(onSearchChange);

  const flatOptions = useMemo<FlatOption[]>(() => {
    const groupedOptions = groups.flatMap((group) =>
      group.options.map((option) => ({
        ...option,
        groupLabel: group.label,
      })),
    );
    return [...options, ...groupedOptions];
  }, [groups, options]);
  const enabledOptions = flatOptions.filter((option) => !option.disabled);
  const selectedOption = flatOptions.find((option) => option.value === value) ?? (value ? { value, label: value } : flatOptions[0] ?? null);
  const activeOption = flatOptions.find((option) => option.value === activeValue && !option.disabled) ?? selectedOption;

  useEffect(() => {
    if (!open) {
      setActiveValue(value);
    }
  }, [open, value]);

  useEffect(() => {
    if (open && activeOption) {
      optionRefs.current[activeOption.value]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeOption, open]);

  useEffect(() => {
    if (!open || !searchable) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, searchable]);

  const radiusClassName = radius === "lg" ? "rounded-lg" : "rounded-xl";
  const sizeClassName = visualSize === "sm" ? "h-9 pl-2.5 pr-9 text-xs" : "h-10 pl-3 pr-10 text-sm";
  const menuTextClassName = visualSize === "sm" ? "text-xs" : "text-sm";
  const iconSize = visualSize === "sm" ? 14 : 16;
  const iconRightClassName = visualSize === "sm" ? "right-2.5" : "right-3";
  const dividerRightClassName = visualSize === "sm" ? "right-7" : "right-8";
  const searchInputClassName =
    visualSize === "sm"
      ? "h-8 pl-7 pr-8 text-xs"
      : "h-9 pl-8 pr-9 text-sm";

  function moveActive(delta: number) {
    if (!enabledOptions.length) {
      return;
    }
    const currentIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === activeValue));
    const nextIndex = (currentIndex + delta + enabledOptions.length) % enabledOptions.length;
    setActiveValue(enabledOptions[nextIndex].value);
  }

  function selectOption(option: SelectFieldOption) {
    if (option.disabled) {
      return;
    }
    onChange(option.value);
    setActiveValue(option.value);
    setOpen(false);
  }

  return (
    <div className={`relative w-full ${className}`}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        onKeyDown={(event) => {
          if (disabled) {
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            moveActive(1);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            moveActive(-1);
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open && activeOption) {
              selectOption(activeOption);
              return;
            }
            setOpen(true);
            return;
          }
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`relative w-full border border-slate-300 bg-slate-50/90 text-left font-medium text-slate-900 shadow-sm shadow-slate-200/45 outline-none ring-1 ring-white/70 transition-colors hover:border-slate-400 hover:bg-white focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none dark:border-slate-600 dark:bg-[#111b2d] dark:text-slate-100 dark:shadow-black/25 dark:ring-slate-800 dark:hover:border-slate-500 dark:hover:bg-[#15233a] dark:focus:border-violet-400 dark:focus:bg-[#111b2d] dark:focus:ring-violet-400/20 dark:disabled:border-slate-800 dark:disabled:bg-slate-900 dark:disabled:text-slate-500 ${radiusClassName} ${sizeClassName}`}
      >
        <span className="block truncate">{selectedOption?.label ?? ""}</span>
        <span
          className={`pointer-events-none absolute top-1/2 h-5 -translate-y-1/2 border-l pf-hairline-strong dark:border-slate-700 ${dividerRightClassName}`}
        />
        <ChevronDown
          size={iconSize}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-500 transition-transform dark:text-slate-300 ${open ? "rotate-180" : ""} ${iconRightClassName}`}
        />
      </button>

      <FloatingSurface
        open={open && !disabled}
        triggerRef={buttonRef}
        preferredPlacement="bottom-start"
        layer="modal"
        matchTriggerWidth
        onOpenChange={setOpen}
        className={`pf-select-field-surface flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-950/12 ring-1 ring-slate-950/5 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45 dark:ring-white/10 ${menuTextClassName}`}
      >
        {searchable ? (
          <div className="border-b border-slate-100 p-1.5 dark:border-slate-800">
            <div className="relative">
              <Search
                size={visualSize === "sm" ? 13 : 15}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
              />
              <input
                ref={searchInputRef}
                value={searchValue}
                onChange={(event) => onSearchChange?.(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    setOpen(false);
                    buttonRef.current?.focus();
                  }
                }}
                aria-label={searchAriaLabel ?? searchPlaceholder}
                placeholder={searchPlaceholder}
                className={`w-full rounded-lg border border-slate-200 bg-slate-50 font-medium text-slate-900 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:bg-slate-950 dark:focus:ring-violet-400/20 ${searchInputClassName}`}
              />
              {searchLoading ? (
                <Loader2
                  size={visualSize === "sm" ? 13 : 15}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400 dark:text-slate-500"
                  aria-label={searchLoadingLabel}
                />
              ) : null}
            </div>
          </div>
        ) : null}
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={buttonId}
          className="min-h-0 flex-1 overflow-y-auto p-1"
        >
          {groups.length
            ? groups.map((group) => (
                <div key={group.label}>
                  <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {group.label}
                  </div>
                  {group.options.map((option) => (
                    <SelectOptionButton
                      key={`${group.label}-${option.value}`}
                      option={option}
                      selected={option.value === value}
                      active={option.value === activeOption?.value}
                      visualSize={visualSize}
                      onSelect={selectOption}
                      refCallback={(element) => {
                        optionRefs.current[option.value] = element;
                      }}
                    />
                  ))}
                </div>
              ))
            : options.map((option) => (
                <SelectOptionButton
                  key={option.value}
                  option={option}
                  selected={option.value === value}
                  active={option.value === activeOption?.value}
                  visualSize={visualSize}
                  onSelect={selectOption}
                  refCallback={(element) => {
                    optionRefs.current[option.value] = element;
                  }}
                />
              ))}
          {!flatOptions.length && emptyLabel ? (
            <div className="px-2.5 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">{emptyLabel}</div>
          ) : null}
        </div>
      </FloatingSurface>
    </div>
  );
}

function SelectOptionButton({
  option,
  selected,
  active,
  visualSize,
  onSelect,
  refCallback,
}: {
  option: SelectFieldOption;
  selected: boolean;
  active: boolean;
  visualSize: "sm" | "md";
  onSelect: (option: SelectFieldOption) => void;
  refCallback: (element: HTMLButtonElement | null) => void;
}) {
  const sizeClassName = visualSize === "sm" ? "min-h-8 px-2 py-1.5 text-xs" : "min-h-9 px-2.5 py-2 text-sm";
  const stateClassName = selected
    ? "bg-indigo-50 text-indigo-700 dark:bg-violet-500/18 dark:text-violet-100"
    : active
      ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
      : "text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white";

  return (
    <button
      ref={refCallback}
      type="button"
      role="option"
      aria-selected={selected}
      disabled={option.disabled}
      onClick={() => onSelect(option)}
      className={`flex w-full items-center gap-2 rounded-lg text-left font-medium outline-none transition-colors disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-60 dark:disabled:text-slate-600 ${sizeClassName} ${stateClassName}`}
    >
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      {selected ? <Check size={14} className="shrink-0" /> : null}
    </button>
  );
}
