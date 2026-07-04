// 资源库卡片用的紧凑分组多选 Popover 编辑器。
// 不直接复用 GenerationResourceGroupMultiSelect（它是 h-11 全宽按钮，为 settings 表单设计）。
// 这里基于 FloatingSurface，组合 chip 展示 + listbox 多选，适合卡片场景。

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Tags } from "lucide-react";

import { FloatingSurface } from "./FloatingSurface";
import { actionButtonComponentForAppearance, type LayoutActionAppearance } from "./layoutActionButtons";
import type { ResourceLibraryGroup } from "../lib/types";

const CHIP_BASE_CLASS =
  "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm";
const CHIP_DEFAULT_CLASS =
  `${CHIP_BASE_CLASS} pf-hairline bg-[rgba(255,255,255,0.8)] pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]`;
const CHIP_OVERFLOW_CLASS =
  `${CHIP_BASE_CLASS} pf-hairline-strong pf-surface-soft pf-ink-muted cursor-pointer transition-colors hover:border-[color:var(--pf-border)] hover:bg-[color:var(--pf-border-soft)] dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)] dark:hover:bg-[color:var(--pf-border-soft)]`;
const CHIP_UNGROUPED_CLASS =
  `${CHIP_BASE_CLASS} border-dashed pf-hairline pf-surface-soft pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]`;
const VISIBLE_CHIP_LIMIT = 3;

interface ResourceGroupChipEditorProps {
  appearance: LayoutActionAppearance;
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
  appearance,
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
  const ActionButtonComponent = actionButtonComponentForAppearance(appearance);
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
        <ActionButtonComponent
          ref={buttonRef}
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
          preset="secondary"
          size="sm"
          leadingIcon={<Tags size={13} aria-hidden="true" />}
          trailingIcon={
            <ChevronDown
              size={12}
              className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          }
        >
          {editLabel}
        </ActionButtonComponent>
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
        className="flex max-h-80 flex-col overflow-hidden rounded-xl border pf-hairline pf-surface p-1 text-sm shadow-xl shadow-slate-950/12 ring-1 ring-[color:var(--pf-border)] dark:border-[color:var(--pf-border)] dark:bg-[#0f1726] dark:shadow-black/45 dark:ring-[color:var(--pf-border)]"
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
                    toggleGroup(group.id);
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
                    toggleGroup(group.id);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.currentTarget.dataset.touchSelectionHandled === "true") {
                      event.currentTarget.dataset.touchSelectionHandled = "";
                      return;
                    }
                    toggleGroup(group.id);
                  }}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                    selected
                      ? "pf-surface-soft pf-ink dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]"
                      : "pf-ink-muted hover:bg-[color:var(--pf-panel-soft)] hover:text-[color:var(--pf-text)] dark:text-[color:var(--pf-muted)] dark:hover:bg-[color:var(--pf-deep)] dark:hover:text-[#fff]"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      selected
                        ? "pf-hairline-strong bg-[color:var(--pf-deep)] text-[#fff] dark:border-[color:var(--pf-border-soft)] dark:bg-[color:var(--pf-border-soft)] dark:text-[color:var(--pf-text)]"
                        : "pf-hairline-strong pf-surface dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]"
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
            <div className="px-2.5 py-2 text-xs font-medium pf-ink-muted dark:text-[color:var(--pf-muted)]">
              {noGroupsLabel}
            </div>
          )}
        </div>
      </FloatingSurface>
    </div>
  );
}
