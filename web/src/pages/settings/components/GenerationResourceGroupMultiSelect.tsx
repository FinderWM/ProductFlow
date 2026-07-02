// 生成资源分组多选下拉（组合框、复选）。从 SettingsPage.tsx 抽出，行为不变。

import { useEffect, useId, useRef, useState } from "react";

import { Check, ChevronDown } from "lucide-react";

import { FloatingSurface } from "../../../components/FloatingSurface";
import type { GenerationResourceGroup } from "../../../lib/types";

function resourceGroupDisplayLabel(group: GenerationResourceGroup, disabledLabel: string): string {
  return group.enabled ? group.name : `${group.name} (${disabledLabel})`;
}

export function GenerationResourceGroupMultiSelect({
  resourceGroups,
  selectedIds,
  disabled,
  disabledGroupLabel,
  noGroupsLabel,
  noSelectionLabel,
  selectedCountLabel,
  ariaLabel,
  onChange,
}: {
  resourceGroups: GenerationResourceGroup[];
  selectedIds: string[];
  disabled: boolean;
  disabledGroupLabel: string;
  noGroupsLabel: string;
  noSelectionLabel: string;
  selectedCountLabel: (count: number) => string;
  ariaLabel: string;
  onChange: (selectedIds: string[]) => void;
}) {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const selectedGroups = selectedIds
    .map((selectedId) => resourceGroups.find((group) => group.id === selectedId))
    .filter((group): group is GenerationResourceGroup => Boolean(group));
  const selectedLabel =
    selectedGroups.length === 0
      ? noSelectionLabel
      : selectedGroups.length === 1
        ? resourceGroupDisplayLabel(selectedGroups[0], disabledGroupLabel)
        : selectedCountLabel(selectedGroups.length);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  function toggleResourceGroup(group: GenerationResourceGroup) {
    if (disabled || !group.enabled) {
      return;
    }
    const nextIds = selectedIds.includes(group.id)
      ? selectedIds.filter((resourceGroupId) => resourceGroupId !== group.id)
      : [...selectedIds, group.id];
    onChange(nextIds);
  }

  return (
    <div className="relative w-full">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className="relative h-11 w-full rounded-lg border pf-hairline-strong bg-slate-50/90 pl-3 pr-10 text-left text-sm font-medium text-slate-900 shadow-sm shadow-slate-200/45 outline-none ring-1 ring-white/70 transition-colors hover:border-slate-400 hover:bg-white focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none dark:border-slate-600 dark:bg-[#111b2d] dark:text-slate-100 dark:shadow-black/25 dark:ring-slate-800 dark:hover:border-slate-500 dark:hover:bg-[#15233a] dark:focus:border-violet-400 dark:focus:bg-[#111b2d] dark:focus:ring-violet-400/20 dark:disabled:border-slate-800 dark:disabled:bg-slate-900 dark:disabled:text-slate-500"
      >
        <span className="block truncate">{selectedLabel}</span>
        <span className="pointer-events-none absolute right-8 top-1/2 h-5 -translate-y-1/2 border-l pf-hairline-strong dark:border-slate-700" />
        <ChevronDown
          size={16}
          className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-transform dark:text-slate-300 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <FloatingSurface
        open={open && !disabled}
        triggerRef={buttonRef}
        preferredPlacement="bottom-start"
        layer="modal"
        matchTriggerWidth
        onOpenChange={setOpen}
        className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-xl shadow-slate-950/12 ring-1 ring-slate-950/5 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45 dark:ring-white/10"
      >
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {resourceGroups.length ? (
            resourceGroups.map((group) => {
              const selected = selectedIds.includes(group.id);
              const groupDisabled = !group.enabled;
              return (
                <button
                  key={group.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={groupDisabled}
                  onPointerDown={(event) => {
                    if (event.pointerType === "touch") {
                      event.currentTarget.dataset.touchSelectionHandled = "";
                    }
                    event.stopPropagation();
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType !== "touch") {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.currentTarget.dataset.touchSelectionHandled === "true") {
                      return;
                    }
                    event.currentTarget.dataset.touchSelectionHandled = "true";
                    toggleResourceGroup(group);
                  }}
                  onTouchStart={(event) => {
                    event.currentTarget.dataset.touchSelectionHandled = "";
                    event.stopPropagation();
                  }}
                  onTouchEnd={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.currentTarget.dataset.touchSelectionHandled === "true") {
                      return;
                    }
                    event.currentTarget.dataset.touchSelectionHandled = "true";
                    toggleResourceGroup(group);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.currentTarget.dataset.touchSelectionHandled === "true") {
                      event.currentTarget.dataset.touchSelectionHandled = "";
                      return;
                    }
                    toggleResourceGroup(group);
                  }}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                    selected
                      ? "bg-indigo-50 text-indigo-700 dark:bg-violet-500/18 dark:text-violet-100"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      selected
                        ? "border-indigo-500 bg-indigo-600 text-white dark:border-violet-400 dark:bg-violet-500"
                        : "pf-hairline-strong bg-white dark:border-slate-600 dark:bg-slate-950"
                    }`}
                    aria-hidden="true"
                  >
                    {selected ? <Check size={12} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {resourceGroupDisplayLabel(group, disabledGroupLabel)}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="px-2.5 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              {noGroupsLabel}
            </div>
          )}
        </div>
      </FloatingSurface>
    </div>
  );
}
