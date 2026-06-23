import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, RotateCcw } from "lucide-react";

import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
import { FloatingSurface } from "./FloatingSurface";

export interface WorkspaceDateTimeRange {
  start_date: string;
  end_date: string;
}

export type WorkspaceQuickRangeId = "today" | "lastDay" | "week" | "month";

export const WORKSPACE_QUICK_RANGE_IDS: WorkspaceQuickRangeId[] = ["today", "lastDay", "week", "month"];

export const WORKSPACE_QUICK_RANGE_LABEL_KEYS: Record<WorkspaceQuickRangeId, TranslationKey> = {
  today: "statusPage.quick.today",
  lastDay: "statusPage.quick.lastDay",
  week: "statusPage.quick.week",
  month: "statusPage.quick.month",
};

type WorkspaceRangeBoundary = "start" | "end";
export type WorkspaceTimePart = "hour" | "minute" | "second";

interface WorkspaceCalendarDay {
  date: string;
  dayOfMonth: number;
  currentMonth: boolean;
  today: boolean;
}

const WORKSPACE_TIME_PARTS: WorkspaceTimePart[] = ["hour", "minute", "second"];

const WORKSPACE_TIME_PART_LABEL_KEYS: Record<WorkspaceTimePart, TranslationKey> = {
  hour: "statusPage.hour",
  minute: "statusPage.minute",
  second: "statusPage.second",
};

const WORKSPACE_TIME_PART_INDEX: Record<WorkspaceTimePart, number> = {
  hour: 0,
  minute: 1,
  second: 2,
};

const WORKSPACE_TIME_PART_MAX: Record<WorkspaceTimePart, number> = {
  hour: 23,
  minute: 59,
  second: 59,
};

function padDatePart(value: number): string {
  return `${value}`.padStart(2, "0");
}

export function toDateTimeLocalSecondValue(value: Date): string {
  const year = value.getFullYear();
  const month = padDatePart(value.getMonth() + 1);
  const day = padDatePart(value.getDate());
  const hours = padDatePart(value.getHours());
  const minutes = padDatePart(value.getMinutes());
  const seconds = padDatePart(value.getSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function toDatePartValue(value: Date): string {
  const year = value.getFullYear();
  const month = padDatePart(value.getMonth() + 1);
  const day = padDatePart(value.getDate());
  return `${year}-${month}-${day}`;
}

function startOfDay(value: Date): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(value: Date): Date {
  const next = startOfDay(value);
  const day = next.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + mondayOffset);
  return next;
}

function startOfMonth(value: Date): Date {
  const next = startOfDay(value);
  next.setDate(1);
  return next;
}

export function workspaceQuickDateTimeRange(id: WorkspaceQuickRangeId, now = new Date()): WorkspaceDateTimeRange {
  const end = new Date(now);
  if (id === "lastDay") {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    return { start_date: toDateTimeLocalSecondValue(start), end_date: toDateTimeLocalSecondValue(end) };
  }
  if (id === "week") {
    return { start_date: toDateTimeLocalSecondValue(startOfWeek(now)), end_date: toDateTimeLocalSecondValue(end) };
  }
  if (id === "month") {
    return { start_date: toDateTimeLocalSecondValue(startOfMonth(now)), end_date: toDateTimeLocalSecondValue(end) };
  }
  return { start_date: toDateTimeLocalSecondValue(startOfDay(now)), end_date: toDateTimeLocalSecondValue(end) };
}

export function datePartFromDateTimeLocal(value: string): string {
  return value.slice(0, 10);
}

export function dateRangeFromDateTimeRange(range: WorkspaceDateTimeRange): WorkspaceDateTimeRange {
  return {
    start_date: range.start_date ? datePartFromDateTimeLocal(range.start_date) : "",
    end_date: range.end_date ? datePartFromDateTimeLocal(range.end_date) : "",
  };
}

function formatDateTimeRangeDisplayValue(value: string): string {
  if (!value) {
    return "";
  }
  const [datePart, timePart = ""] = value.split("T");
  if (!timePart) {
    return datePart.replaceAll("-", "/");
  }
  const normalizedTime = timePart.length === 5 ? `${timePart}:00` : timePart;
  return `${datePart.replaceAll("-", "/")} ${normalizedTime}`;
}

function timePartFromDateTimeLocal(value: string, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const [, timePart = ""] = value.split("T");
  if (/^\d{2}:\d{2}:\d{2}$/.test(timePart)) {
    return timePart;
  }
  if (/^\d{2}:\d{2}$/.test(timePart)) {
    return `${timePart}:00`;
  }
  return fallback;
}

function hasTimePartFromDateTimeLocal(value: string): boolean {
  const [, timePart = ""] = value.split("T");
  return /^\d{2}:\d{2}(:\d{2})?$/.test(timePart);
}

function formatTimePartDisplayValue(value: string): string {
  return hasTimePartFromDateTimeLocal(value) ? timePartFromDateTimeLocal(value, "") : "";
}

export function removeWorkspaceTimePart(value: string): string {
  return datePartFromDateTimeLocal(value);
}

export function composeDateTimeLocalSecondValue(datePart: string, timePart: string, fallbackTime: string): string {
  if (!datePart) {
    return "";
  }
  return `${datePart}T${timePartFromDateTimeLocal(`2000-01-01T${timePart}`, fallbackTime)}`;
}

function splitTimeParts(value: string): [string, string, string] {
  const [hour = "00", minute = "00", second = "00"] = value.split(":");
  return [hour, minute, second];
}

export function normalizeWorkspaceTimePart(value: string, part: WorkspaceTimePart): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return "00";
  }
  return padDatePart(Math.min(Number(digits.slice(-2)), WORKSPACE_TIME_PART_MAX[part]));
}

export function replaceWorkspaceTimePart(time: string, part: WorkspaceTimePart, value: string): string {
  const parts = splitTimeParts(time);
  parts[WORKSPACE_TIME_PART_INDEX[part]] = normalizeWorkspaceTimePart(value, part);
  return parts.join(":");
}

export function shiftWorkspaceTimePart(time: string, part: WorkspaceTimePart, delta: number): string {
  const parts = splitTimeParts(time);
  const index = WORKSPACE_TIME_PART_INDEX[part];
  const max = WORKSPACE_TIME_PART_MAX[part];
  const current = Number(parts[index]) || 0;
  const next = (current + delta + max + 1) % (max + 1);
  parts[index] = padDatePart(next);
  return parts.join(":");
}

export function workspaceTimePartOptions(part: WorkspaceTimePart): string[] {
  return Array.from({ length: WORKSPACE_TIME_PART_MAX[part] + 1 }, (_, value) => padDatePart(value));
}

function clampDraftRange(range: WorkspaceDateTimeRange, changedBoundary: WorkspaceRangeBoundary): WorkspaceDateTimeRange {
  if (!range.start_date || !range.end_date || range.start_date <= range.end_date) {
    return range;
  }
  return changedBoundary === "start"
    ? { start_date: range.start_date, end_date: range.start_date }
    : { start_date: range.end_date, end_date: range.end_date };
}

export function selectWorkspaceDateRangeDay(
  range: WorkspaceDateTimeRange,
  activeBoundary: WorkspaceRangeBoundary,
  datePart: string,
): { range: WorkspaceDateTimeRange; activeBoundary: WorkspaceRangeBoundary } {
  const field = rangeBoundaryField(activeBoundary);
  const fallbackTime = activeBoundary === "start" ? "00:00:00" : "23:59:59";
  const currentTime = timePartFromDateTimeLocal(range[field], fallbackTime);
  const hasTime = hasTimePartFromDateTimeLocal(range[field]);
  const nextRange = clampDraftRange(
    {
      ...range,
      [field]: hasTime ? composeDateTimeLocalSecondValue(datePart, currentTime, fallbackTime) : datePart,
    },
    activeBoundary,
  );
  return {
    range: nextRange,
    activeBoundary: activeBoundary === "start" ? "end" : "start",
  };
}

function parseDatePart(value: string): { year: number; monthIndex: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return null;
  }
  return { year, monthIndex, day };
}

function monthDateFromRange(range: WorkspaceDateTimeRange): Date {
  const source = range.start_date || range.end_date;
  const parsed = parseDatePart(datePartFromDateTimeLocal(source));
  if (parsed) {
    return new Date(parsed.year, parsed.monthIndex, 1);
  }
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

function monthDateFromValue(value: string): Date | null {
  const parsed = parseDatePart(datePartFromDateTimeLocal(value));
  return parsed ? new Date(parsed.year, parsed.monthIndex, 1) : null;
}

function addCalendarMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

export function workspaceCalendarMonthDays(monthDate: Date, today = new Date()): WorkspaceCalendarDay[] {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = firstOfMonth.getDay() === 0 ? 6 : firstOfMonth.getDay() - 1;
  const firstVisibleDate = new Date(firstOfMonth);
  firstVisibleDate.setDate(firstVisibleDate.getDate() - mondayOffset);
  const todayValue = toDatePartValue(today);

  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(firstVisibleDate);
    current.setDate(firstVisibleDate.getDate() + index);
    const date = toDatePartValue(current);
    return {
      date,
      dayOfMonth: current.getDate(),
      currentMonth: current.getMonth() === monthDate.getMonth(),
      today: date === todayValue,
    };
  });
}

function rangeBoundaryField(boundary: WorkspaceRangeBoundary): keyof WorkspaceDateTimeRange {
  return boundary === "start" ? "start_date" : "end_date";
}

interface WorkspaceTimeColumnsProps {
  idPrefix: string;
  boundary: WorkspaceRangeBoundary;
  value: string;
  disabled: boolean;
  label: string;
  onFocus: () => void;
  onChange: (boundary: WorkspaceRangeBoundary, part: WorkspaceTimePart, value: string) => void;
}

function WorkspaceTimeColumns({
  idPrefix,
  boundary,
  value,
  disabled,
  label,
  onFocus,
  onChange,
}: WorkspaceTimeColumnsProps) {
  const { t } = useI18n();
  const [hour, minute, second] = splitTimeParts(value);
  const selectedValues: Record<WorkspaceTimePart, string> = { hour, minute, second };
  const selectedButtonRefs = useRef<Partial<Record<WorkspaceTimePart, HTMLButtonElement | null>>>({});

  useEffect(() => {
    WORKSPACE_TIME_PARTS.forEach((part) => {
      selectedButtonRefs.current[part]?.scrollIntoView?.({ block: "center" });
    });
  }, [hour, minute, second]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, part: WorkspaceTimePart) => {
    if (disabled) {
      return;
    }
    const partIndex = WORKSPACE_TIME_PART_INDEX[part];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(
        boundary,
        part,
        shiftWorkspaceTimePart(value, part, event.key === "ArrowDown" ? 1 : -1).split(":")[partIndex],
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onChange(boundary, part, event.key === "Home" ? "00" : padDatePart(WORKSPACE_TIME_PART_MAX[part]));
    }
  };

  return (
    <div
      className="pf-workspace-time-columns grid grid-cols-3 overflow-hidden rounded-xl border bg-white/80 text-zinc-900 dark:bg-slate-950/70 dark:text-slate-100"
      role="group"
      aria-label={`${label} ${t("statusPage.time")}`}
    >
      {WORKSPACE_TIME_PARTS.map((part) => {
        const partLabel = t(WORKSPACE_TIME_PART_LABEL_KEYS[part]);
        return (
          <div
            key={part}
            className="pf-workspace-time-column min-w-0 border-r border-zinc-200/70 last:border-r-0 dark:border-slate-700/80"
          >
            <div className="pf-workspace-time-column-scroll h-64 overflow-y-auto overscroll-contain py-[6.875rem]">
              {workspaceTimePartOptions(part).map((option) => {
                const selected = option === selectedValues[part];
                return (
                  <button
                    key={option}
                    ref={(element) => {
                      if (selected) {
                        selectedButtonRefs.current[part] = element;
                      }
                    }}
                    id={`${idPrefix}-${boundary}-${part}-${option}`}
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    aria-label={`${label} ${partLabel} ${option}`}
                    data-selected={selected ? "true" : undefined}
                    onFocus={onFocus}
                    onClick={() => {
                      onFocus();
                      onChange(boundary, part, option);
                    }}
                    onKeyDown={(event) => handleKeyDown(event, part)}
                    className="pf-workspace-time-option flex h-9 w-full items-center justify-center gap-0.5 px-1 text-sm font-semibold tabular-nums outline-none transition data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:data-[selected=true]:bg-slate-800 dark:data-[selected=true]:text-slate-50"
                  >
                    <span>{option}</span>
                    {selected ? (
                      <span className="text-[10px] font-semibold leading-none opacity-80">{partLabel}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface WorkspaceDateTimeRangeFieldProps {
  idPrefix: string;
  value: WorkspaceDateTimeRange;
  activeQuickRange?: WorkspaceQuickRangeId | null;
  disabled?: boolean;
  className?: string;
  onChange: (range: WorkspaceDateTimeRange) => void;
  onQuickRangeChange?: (rangeId: WorkspaceQuickRangeId) => void;
}

export function WorkspaceDateTimeRangeField({
  idPrefix,
  value,
  activeQuickRange = null,
  disabled = false,
  className = "",
  onChange,
  onQuickRangeChange,
}: WorkspaceDateTimeRangeFieldProps) {
  const { locale, t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [timePickerBoundary, setTimePickerBoundary] = useState<WorkspaceRangeBoundary | null>(null);
  const [draftRange, setDraftRange] = useState<WorkspaceDateTimeRange>(value);
  const [activeBoundary, setActiveBoundary] = useState<WorkspaceRangeBoundary>("start");
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => monthDateFromRange(value));
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const startBoundaryRef = useRef<HTMLButtonElement | null>(null);
  const endBoundaryRef = useRef<HTMLButtonElement | null>(null);
  const startTimeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const endTimeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rangePanelId = `${idPrefix}-range-panel`;
  const timePanelId = `${idPrefix}-time-panel`;
  const displayStart = formatDateTimeRangeDisplayValue(value.start_date);
  const displayEnd = formatDateTimeRangeDisplayValue(value.end_date);
  const calendarDays = useMemo(() => workspaceCalendarMonthDays(visibleMonth), [visibleMonth]);
  const weekdayLabels = useMemo(() => {
    const monday = new Date(2026, 5, 1);
    const formatter = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, index) => {
      const value = new Date(monday);
      value.setDate(monday.getDate() + index);
      return formatter.format(value);
    });
  }, [locale]);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(visibleMonth),
    [locale, visibleMonth],
  );
  const dayLabelFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);
  const activeDatePart = datePartFromDateTimeLocal(draftRange[rangeBoundaryField(activeBoundary)]);
  const startDatePart = datePartFromDateTimeLocal(draftRange.start_date);
  const endDatePart = datePartFromDateTimeLocal(draftRange.end_date);
  const timeBoundary = timePickerBoundary ?? activeBoundary;
  const timeBoundaryField = rangeBoundaryField(timeBoundary);
  const timeBoundaryDatePart = datePartFromDateTimeLocal(draftRange[timeBoundaryField]);
  const timeBoundaryFallback = timeBoundary === "start" ? "00:00:00" : "23:59:59";
  const timeBoundaryValue = timePartFromDateTimeLocal(draftRange[timeBoundaryField], timeBoundaryFallback);
  const timeBoundaryTriggerRef = timeBoundary === "start" ? startTimeTriggerRef : endTimeTriggerRef;
  const clearRangeLabel = `${t("inspirations.search.clear")} ${t("statusPage.rangeTitle")}`;
  const canClearRange = Boolean(!disabled && (value.start_date || value.end_date));

  const commitLinkedRange = (nextRange: WorkspaceDateTimeRange, changedBoundary: WorkspaceRangeBoundary) => {
    const linkedRange = clampDraftRange(nextRange, changedBoundary);
    setDraftRange(linkedRange);
    onChange(linkedRange);
  };

  const handleBoundarySelect = (boundary: WorkspaceRangeBoundary) => {
    setTimePickerBoundary(null);
    setActiveBoundary(boundary);
    const nextMonth = monthDateFromValue(draftRange[rangeBoundaryField(boundary)]);
    if (nextMonth) {
      setVisibleMonth(nextMonth);
    }
  };

  const handleTimeTriggerSelect = (boundary: WorkspaceRangeBoundary) => {
    setActiveBoundary(boundary);
    const nextMonth = monthDateFromValue(draftRange[rangeBoundaryField(boundary)]);
    if (nextMonth) {
      setVisibleMonth(nextMonth);
    }
    setTimePickerBoundary((current) => (current === boundary ? null : boundary));
  };

  const handleDaySelect = (datePart: string) => {
    setTimePickerBoundary(null);
    const nextSelection = selectWorkspaceDateRangeDay(draftRange, activeBoundary, datePart);
    commitLinkedRange(nextSelection.range, activeBoundary);
    setActiveBoundary(nextSelection.activeBoundary);
    window.setTimeout(() => {
      const nextRef = nextSelection.activeBoundary === "start" ? startBoundaryRef : endBoundaryRef;
      nextRef.current?.focus();
    }, 0);
  };

  const handleTimeChange = (boundary: WorkspaceRangeBoundary, nextTime: string) => {
    const field = rangeBoundaryField(boundary);
    const fallbackTime = boundary === "start" ? "00:00:00" : "23:59:59";
    const datePart = datePartFromDateTimeLocal(draftRange[field]);
    if (!datePart) {
      return;
    }
    commitLinkedRange(
      {
        ...draftRange,
        [field]: composeDateTimeLocalSecondValue(datePart, nextTime, fallbackTime),
      },
      boundary,
    );
  };

  const handleTimePartChange = (boundary: WorkspaceRangeBoundary, part: WorkspaceTimePart, nextValue: string) => {
    const field = rangeBoundaryField(boundary);
    const fallbackTime = boundary === "start" ? "00:00:00" : "23:59:59";
    const currentTime = timePartFromDateTimeLocal(draftRange[field], fallbackTime);
    handleTimeChange(boundary, replaceWorkspaceTimePart(currentTime, part, nextValue));
  };

  const handleRangeClear = () => {
    const emptyRange = { start_date: "", end_date: "" };
    setPickerOpen(false);
    setTimePickerBoundary(null);
    setActiveBoundary("start");
    setDraftRange(emptyRange);
    onChange(emptyRange);
  };

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }
    setTimePickerBoundary(null);
    setActiveBoundary("start");
    setVisibleMonth(monthDateFromRange(value));
    window.setTimeout(() => startBoundaryRef.current?.focus(), 0);
  }, [pickerOpen]);

  useEffect(() => {
    setDraftRange(value);
  }, [value]);

  useEffect(() => {
    if (disabled) {
      setPickerOpen(false);
      setTimePickerBoundary(null);
    }
  }, [disabled]);

  return (
    <div className={`pf-workspace-datetime-range relative min-w-0 space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
          {t("statusPage.rangeTitle")}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {WORKSPACE_QUICK_RANGE_IDS.map((rangeId) => (
            <button
              key={rangeId}
              type="button"
              onClick={() => onQuickRangeChange?.(rangeId)}
              disabled={disabled}
              aria-current={activeQuickRange === rangeId ? "true" : undefined}
              className="pf-workspace-date-quick inline-flex h-[15px] items-center justify-center rounded-md border px-1 text-[10px] font-medium leading-none transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(WORKSPACE_QUICK_RANGE_LABEL_KEYS[rangeId])}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-controls={rangePanelId}
          disabled={disabled}
          onClick={() => setPickerOpen((current) => !current)}
          className="pf-workspace-date-range-shell pf-workspace-date-range-trigger flex min-w-0 h-11 flex-1 items-center gap-2 rounded-xl border px-3 text-left shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className={`min-w-0 flex-1 truncate text-sm ${displayStart ? "font-medium" : "font-normal text-[color:var(--pf-subtle)]"}`}>
            {displayStart || t("statusPage.startDate")}
          </span>
          <span className="shrink-0 text-xs font-semibold text-[color:var(--pf-subtle)]" aria-hidden="true">
            -
          </span>
          <span className={`min-w-0 flex-1 truncate text-sm ${displayEnd ? "font-medium" : "font-normal text-[color:var(--pf-subtle)]"}`}>
            {displayEnd || t("statusPage.endDate")}
          </span>
        </button>
        <button
          type="button"
          disabled={!canClearRange}
          aria-label={clearRangeLabel}
          title={clearRangeLabel}
          onClick={handleRangeClear}
          className="pf-workspace-date-range-clear inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-zinc-600 shadow-sm outline-none transition hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-300 dark:hover:text-slate-50"
        >
          <RotateCcw size={15} aria-hidden="true" />
        </button>
      </div>
      <FloatingSurface
        open={pickerOpen}
        triggerRef={triggerRef}
        preferredPlacement="bottom-start"
        matchTriggerWidth={false}
        minWidth={320}
        margin={12}
        onOpenChange={setPickerOpen}
        className="pf-workspace-date-range-popover grid w-[min(34rem,calc(100vw-1.5rem))] gap-3 overflow-auto rounded-2xl border p-3 shadow-xl"
      >
        <div id={rangePanelId} role="dialog" aria-modal="false" aria-label={t("statusPage.rangeTitle")}>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="grid content-start gap-2 lg:order-2">
              <div
                className="pf-workspace-date-boundary rounded-xl border p-3 transition"
                data-active-boundary={activeBoundary === "start" ? "true" : undefined}
              >
                <button
                  ref={startBoundaryRef}
                  type="button"
                  aria-pressed={activeBoundary === "start"}
                  onClick={() => handleBoundarySelect("start")}
                  className="pf-workspace-date-boundary-button w-full text-left outline-none"
                >
                  <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--pf-muted)]">
                    <CalendarDays size={14} aria-hidden="true" />
                    {t("statusPage.startDate")}
                  </span>
                  <span className="mt-2 block truncate text-sm font-semibold">
                    {formatDateTimeRangeDisplayValue(draftRange.start_date) || t("statusPage.startDate")}
                  </span>
                </button>
                <button
                  ref={startTimeTriggerRef}
                  type="button"
                  disabled={disabled || !startDatePart}
                  aria-haspopup="dialog"
                  aria-expanded={timePickerBoundary === "start"}
                  aria-controls={timePanelId}
                  onClick={() => handleTimeTriggerSelect("start")}
                  className="pf-workspace-time-trigger mt-2 flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Clock size={14} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate tabular-nums">
                    {formatTimePartDisplayValue(draftRange.start_date) || (startDatePart ? "00:00:00" : t("statusPage.time"))}
                  </span>
                </button>
              </div>
              <div
                className="pf-workspace-date-boundary rounded-xl border p-3 transition"
                data-active-boundary={activeBoundary === "end" ? "true" : undefined}
              >
                <button
                  ref={endBoundaryRef}
                  type="button"
                  aria-pressed={activeBoundary === "end"}
                  onClick={() => handleBoundarySelect("end")}
                  className="pf-workspace-date-boundary-button w-full text-left outline-none"
                >
                  <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--pf-muted)]">
                    <CalendarDays size={14} aria-hidden="true" />
                    {t("statusPage.endDate")}
                  </span>
                  <span className="mt-2 block truncate text-sm font-semibold">
                    {formatDateTimeRangeDisplayValue(draftRange.end_date) || t("statusPage.endDate")}
                  </span>
                </button>
                <button
                  ref={endTimeTriggerRef}
                  type="button"
                  disabled={disabled || !endDatePart}
                  aria-haspopup="dialog"
                  aria-expanded={timePickerBoundary === "end"}
                  aria-controls={timePanelId}
                  onClick={() => handleTimeTriggerSelect("end")}
                  className="pf-workspace-time-trigger mt-2 flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Clock size={14} className="shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate tabular-nums">
                    {formatTimePartDisplayValue(draftRange.end_date) || (endDatePart ? "23:59:59" : t("statusPage.time"))}
                  </span>
                </button>
              </div>
            </div>

            <div className="min-w-0 rounded-xl border border-[color:var(--pf-border-soft)] p-2 lg:order-1">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <button
                  type="button"
                  onClick={() => {
                    setTimePickerBoundary(null);
                    setVisibleMonth((current) => addCalendarMonths(current, -1));
                  }}
                  className="pf-workspace-date-nav inline-flex h-8 w-8 items-center justify-center rounded-lg border transition"
                  aria-label={t("statusPage.previousMonth")}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <div className="text-sm font-semibold text-[color:var(--pf-text)]">{monthLabel}</div>
                <button
                  type="button"
                  onClick={() => {
                    setTimePickerBoundary(null);
                    setVisibleMonth((current) => addCalendarMonths(current, 1));
                  }}
                  className="pf-workspace-date-nav inline-flex h-8 w-8 items-center justify-center rounded-lg border transition"
                  aria-label={t("statusPage.nextMonth")}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 px-1 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--pf-subtle)]">
                {weekdayLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {calendarDays.map((day) => {
                  const isRangeStart = day.date === startDatePart;
                  const isRangeEnd = day.date === endDatePart;
                  const isInRange = Boolean(startDatePart && endDatePart && day.date > startDatePart && day.date < endDatePart);
                  const isActiveDate = day.date === activeDatePart;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      onClick={() => handleDaySelect(day.date)}
                      aria-pressed={isRangeStart || isRangeEnd}
                      data-active={isActiveDate ? "true" : undefined}
                      data-range-start={isRangeStart ? "true" : undefined}
                      data-range-end={isRangeEnd ? "true" : undefined}
                      data-in-range={isInRange ? "true" : undefined}
                      data-outside-month={day.currentMonth ? undefined : "true"}
                      data-today={day.today ? "true" : undefined}
                      className="pf-workspace-date-day inline-flex aspect-square min-h-8 items-center justify-center rounded-lg text-sm font-semibold tabular-nums transition"
                      aria-label={dayLabelFormatter.format(new Date(`${day.date}T00:00:00`))}
                    >
                      {day.dayOfMonth}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <FloatingSurface
          open={Boolean(pickerOpen && timePickerBoundary)}
          triggerRef={timeBoundaryTriggerRef}
          preferredPlacement="bottom-start"
          matchTriggerWidth={false}
          minWidth={252}
          margin={12}
          onOpenChange={(open) => {
            if (!open) {
              setTimePickerBoundary(null);
            }
          }}
          className="pf-workspace-time-popover w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border p-2 shadow-xl"
        >
          <div
            id={timePanelId}
            role="dialog"
            aria-modal="false"
            aria-label={`${timeBoundary === "start" ? t("statusPage.startDate") : t("statusPage.endDate")} ${t("statusPage.time")}`}
          >
            <WorkspaceTimeColumns
              idPrefix={idPrefix}
              boundary={timeBoundary}
              value={timeBoundaryValue}
              disabled={disabled || !timeBoundaryDatePart}
              label={timeBoundary === "start" ? t("statusPage.startDate") : t("statusPage.endDate")}
              onFocus={() => setActiveBoundary(timeBoundary)}
              onChange={handleTimePartChange}
            />
          </div>
        </FloatingSurface>
      </FloatingSurface>
    </div>
  );
}
