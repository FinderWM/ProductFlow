// 资源库卡片用的紧凑分组多选 Popover 编辑器。
// 不直接复用 GenerationResourceGroupMultiSelect（它是 h-11 全宽按钮，为 settings 表单设计）。
// 这里基于 FloatingSurface，组合 chip 展示 + listbox 多选，适合卡片场景。

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Tags } from "lucide-react";

import { FloatingSurface } from "./FloatingSurface";
import type { ResourceLibraryGroup } from "../lib/types";

const CHIP_BASE_CLASS =
  "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm";
const CHIP_DEFAULT_CLASS =
  `${CHIP_BASE_CLASS} border-slate-200 bg-white/80 text-slate-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300`;
const CHIP_OVERFLOW_CLASS =
  `${CHIP_BASE_CLASS} border-indigo-200 bg-indigo-50 text-indigo-700 cursor-pointer transition-colors hover:border-indigo-300 hover:bg-indigo-100 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-200 dark:hover:bg-violet-500/25`;
const CHIP_UNGROUPED_CLASS =
  `${CHIP_BASE_CLASS} border-dashed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-500`;
const TRIGGER_CLASS =
  "pf-workspace-action-secondary inline-flex h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";

const VISIBLE_CHIP_LIMIT = 3;

interface ResourceGroupChipEditorProps {
  groups: ResourceLibraryGroup[];
  selectedIds: string[];
  disabled: boolean;
  editLabel: string;
  ungroupedLabel: string;
  moreLabel: (count: number) => string;
  listboxAriaLabel: string;
  noGroupsLabel: string;
  onChange: (selectedIds: string[]) => void;
}

function ResourceGroupChip({ group }: { group: { id: string; name: string } }) {
  return (
    <span className={CHIP_DEFAULT_CLASS} title={group.name}>
      <span className="truncate">{group.name}</span>
    </span>
  );
}

export function ResourceGroupChipEditor({
  groups,
  selectedIds,
  disabled,
  editLabel,
  ungroupedLabel,
  moreLabel,
  listboxAriaLabel,
  noGroupsLabel,
  onChange,
}: ResourceGroupChipEditorProps) {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setShowAll(false);
    }
  }, [disabled]);

  // 选中分组按 groups 原始顺序展示（避免草稿顺序变化导致徽章跳动）
  const selectedGroups = selectedIds
    .map((selectedId) => groups.find((group) => group.id === selectedId))
    .filter((group): group is ResourceLibraryGroup => Boolean(group));
  const visibleGroups = showAll ? selectedGroups : selectedGroups.slice(0, VISIBLE_CHIP_LIMIT);
  const hiddenCount = selectedGroups.length - visibleGroups.length;

  function toggleGroup(groupId: string) {
    if (disabled) {
      return;
    }
    const nextIds = selectedIds.includes(groupId)
      ? selectedIds.filter((id) => id !== groupId)
      : [...selectedIds, groupId];
    onChange(nextIds);
  }

  function handleOverflowClick() {
    // 超过阈值时，点击「+N 更多」展开全部，同时打开编辑 Popover 便于继续操作
    setShowAll(true);
    setOpen(true);
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-6 flex-wrap items-center gap-1">
        {selectedGroups.length === 0 ? (
          <span className={CHIP_UNGROUPED_CLASS}>{ungroupedLabel}</span>
        ) : (
          <>
            {visibleGroups.map((group) => (
              <ResourceGroupChip key={group.id} group={group} />
            ))}
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={handleOverflowClick}
                className={CHIP_OVERFLOW_CLASS}
                aria-label={moreLabel(hiddenCount)}
                title={moreLabel(hiddenCount)}
              >
                <span className="truncate">{moreLabel(hiddenCount)}</span>
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="flex justify-end">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label={editLabel}
          title={editLabel}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              setOpen(false);
            }
          }}
          className={TRIGGER_CLASS}
        >
          <Tags size={13} className="shrink-0" aria-hidden="true" />
          <span>{editLabel}</span>
          <ChevronDown
            size={12}
            className={`shrink-0 text-slate-500 transition-transform dark:text-slate-300 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <FloatingSurface
        open={open && !disabled}
        triggerRef={buttonRef}
        preferredPlacement="bottom-end"
        layer="popover"
        matchTriggerWidth={false}
        minWidth={220}
        onOpenChange={(next) => {
          setOpen(next);
          // 关闭 Popover 时不重置 showAll，保持已展开的徽章可见，避免抖动
        }}
        className="flex max-h-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-xl shadow-slate-950/12 ring-1 ring-slate-950/5 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45 dark:ring-white/10"
      >
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={listboxAriaLabel}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {groups.length ? (
            groups.map((group) => {
              const selected = selectedIds.includes(group.id);
              return (
                <button
                  key={group.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={disabled}
                  onClick={() => toggleGroup(group.id)}
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
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
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
