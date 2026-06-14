import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";

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

export function composeDateTimeLocalSecondValue(datePart: string, timePart: string, fallbackTime: string): string {
  if (!datePart) {
    return "";
  }
  return `${datePart}T${timePartFromDateTimeLocal(`2000-01-01T${timePart}`, fallbackTime)}`;
}

function splitDateTimeLocalValue(value: string, fallbackTime: string): { date: string; time: string } {
  return {
    date: datePartFromDateTimeLocal(value),
    time: timePartFromDateTimeLocal(value, fallbackTime),
  };
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

function clampDraftRange(range: WorkspaceDateTimeRange, changedBoundary: WorkspaceRangeBoundary): WorkspaceDateTimeRange {
  if (!range.start_date || !range.end_date || range.start_date <= range.end_date) {
    return range;
  }
  return changedBoundary === "start"
    ? { start_date: range.start_date, end_date: range.start_date }
    : { start_date: range.end_date, end_date: range.end_date };
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

interface WorkspaceTimeSegmentsProps {
  idPrefix: string;
  boundary: WorkspaceRangeBoundary;
  value: string;
  disabled: boolean;
  label: string;
  onFocus: () => void;
  onChange: (boundary: WorkspaceRangeBoundary, part: WorkspaceTimePart, value: string) => void;
}

function WorkspaceTimeSegments({
  idPrefix,
  boundary,
  value,
  disabled,
  label,
  onFocus,
  onChange,
}: WorkspaceTimeSegmentsProps) {
  const { t } = useI18n();
  const parts = splitTimeParts(value);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, part: WorkspaceTimePart) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    event.preventDefault();
    onChange(boundary, part, shiftWorkspaceTimePart(value, part, event.key === "ArrowUp" ? 1 : -1).split(":")[
      WORKSPACE_TIME_PART_INDEX[part]
    ]);
  };

  return (
    <div className="pf-workspace-time-segments mt-2 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1">
      {WORKSPACE_TIME_PARTS.map((part, index) => (
        <Fragment key={part}>
          {index > 0 ? (
            <span className="text-center text-sm font-semibold text-[color:var(--pf-subtle)]">
              :
            </span>
          ) : null}
          <input
            id={`${idPrefix}-${boundary}-${part}`}
            name={`${idPrefix}_${boundary}_${part}`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={parts[WORKSPACE_TIME_PART_INDEX[part]]}
            disabled={disabled}
            aria-label={`${label} ${t(WORKSPACE_TIME_PART_LABEL_KEYS[part])}`}
            onFocus={(event) => {
              onFocus();
              event.currentTarget.select();
            }}
            onClick={(event) => event.currentTarget.select()}
            onMouseUp={(event) => event.preventDefault()}
            onChange={(event) => onChange(boundary, part, event.target.value)}
            onKeyDown={(event) => handleKeyDown(event, part)}
            className="pf-workspace-time-segment h-8 min-w-0 rounded-lg border px-1 text-center text-sm font-semibold tabular-nums outline-none transition disabled:cursor-not-allowed"
          />
        </Fragment>
      ))}
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
  const [draftRange, setDraftRange] = useState<WorkspaceDateTimeRange>(value);
  const [activeBoundary, setActiveBoundary] = useState<WorkspaceRangeBoundary>("start");
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => monthDateFromRange(value));
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const startBoundaryRef = useRef<HTMLButtonElement | null>(null);
  const endBoundaryRef = useRef<HTMLButtonElement | null>(null);
  const rangePanelId = `${idPrefix}-range-panel`;
  const displayStart = formatDateTimeRangeDisplayValue(value.start_date);
  const displayEnd = formatDateTimeRangeDisplayValue(value.end_date);
  const draftStart = splitDateTimeLocalValue(draftRange.start_date, "00:00:00");
  const draftEnd = splitDateTimeLocalValue(draftRange.end_date, "23:59:59");
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

  const setLinkedDraftRange = (nextRange: WorkspaceDateTimeRange, changedBoundary: WorkspaceRangeBoundary) => {
    setDraftRange(clampDraftRange(nextRange, changedBoundary));
  };

  const handleBoundarySelect = (boundary: WorkspaceRangeBoundary) => {
    setActiveBoundary(boundary);
    const nextMonth = monthDateFromValue(draftRange[rangeBoundaryField(boundary)]);
    if (nextMonth) {
      setVisibleMonth(nextMonth);
    }
  };

  const handleDaySelect = (datePart: string) => {
    const field = rangeBoundaryField(activeBoundary);
    const fallbackTime = activeBoundary === "start" ? "00:00:00" : "23:59:59";
    const currentTime = timePartFromDateTimeLocal(draftRange[field], fallbackTime);
    setLinkedDraftRange(
      {
        ...draftRange,
        [field]: composeDateTimeLocalSecondValue(datePart, currentTime, fallbackTime),
      },
      activeBoundary,
    );
    if (activeBoundary === "start") {
      setActiveBoundary("end");
      window.setTimeout(() => endBoundaryRef.current?.focus(), 0);
    }
  };

  const handleTimeChange = (boundary: WorkspaceRangeBoundary, nextTime: string) => {
    const field = rangeBoundaryField(boundary);
    const fallbackTime = boundary === "start" ? "00:00:00" : "23:59:59";
    const datePart = datePartFromDateTimeLocal(draftRange[field]);
    if (!datePart) {
      return;
    }
    setLinkedDraftRange(
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

  const handleApply = () => {
    onChange(draftRange);
    setPickerOpen(false);
    triggerRef.current?.focus();
  };

  const handleCancel = () => {
    setDraftRange(value);
    setPickerOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }
    setDraftRange(value);
    setActiveBoundary("start");
    setVisibleMonth(monthDateFromRange(value));
    window.setTimeout(() => startBoundaryRef.current?.focus(), 0);
  }, [pickerOpen, value.end_date, value.start_date]);

  useEffect(() => {
    if (pickerOpen) {
      return;
    }
    setDraftRange(value);
  }, [pickerOpen, value.end_date, value.start_date]);

  useEffect(() => {
    if (disabled) {
      setPickerOpen(false);
    }
  }, [disabled]);

  return (
    <div className={`pf-workspace-datetime-range relative min-w-0 space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--pf-muted)]">
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
              className="pf-workspace-date-quick inline-flex h-[15px] items-center justify-center rounded-md border px-1 text-[9px] font-medium leading-none transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(WORKSPACE_QUICK_RANGE_LABEL_KEYS[rangeId])}
            </button>
          ))}
        </div>
      </div>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        aria-controls={rangePanelId}
        disabled={disabled}
        onClick={() => setPickerOpen((current) => !current)}
        className="pf-workspace-date-range-shell pf-workspace-date-range-trigger flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {displayStart || t("statusPage.startDate")}
        </span>
        <span className="shrink-0 text-xs font-semibold text-[color:var(--pf-subtle)]" aria-hidden="true">
          -
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {displayEnd || t("statusPage.endDate")}
        </span>
      </button>
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
                  className="w-full text-left outline-none"
                >
                  <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--pf-muted)]">
                    <CalendarDays size={14} aria-hidden="true" />
                    {t("statusPage.startDate")}
                  </span>
                  <span className="mt-2 block truncate text-sm font-semibold">
                    {formatDateTimeRangeDisplayValue(draftRange.start_date) || t("statusPage.startDate")}
                  </span>
                </button>
                <label className="mt-2 block">
                  <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--pf-muted)]">
                    <Clock size={14} aria-hidden="true" />
                    {t("statusPage.time")}
                  </span>
                  <WorkspaceTimeSegments
                    idPrefix={idPrefix}
                    boundary="start"
                    value={draftStart.time}
                    disabled={disabled || !draftStart.date}
                    label={t("statusPage.startDate")}
                    onFocus={() => handleBoundarySelect("start")}
                    onChange={handleTimePartChange}
                  />
                </label>
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
                  className="w-full text-left outline-none"
                >
                  <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--pf-muted)]">
                    <CalendarDays size={14} aria-hidden="true" />
                    {t("statusPage.endDate")}
                  </span>
                  <span className="mt-2 block truncate text-sm font-semibold">
                    {formatDateTimeRangeDisplayValue(draftRange.end_date) || t("statusPage.endDate")}
                  </span>
                </button>
                <label className="mt-2 block">
                  <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--pf-muted)]">
                    <Clock size={14} aria-hidden="true" />
                    {t("statusPage.time")}
                  </span>
                  <WorkspaceTimeSegments
                    idPrefix={idPrefix}
                    boundary="end"
                    value={draftEnd.time}
                    disabled={disabled || !draftEnd.date}
                    label={t("statusPage.endDate")}
                    onFocus={() => handleBoundarySelect("end")}
                    onChange={handleTimePartChange}
                  />
                </label>
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="pf-workspace-action-secondary h-9 rounded-xl px-3.5 text-xs font-semibold"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={disabled}
                  className="pf-workspace-action-primary h-9 rounded-xl px-3.5 text-xs font-semibold"
                >
                  {t("common.apply")}
                </button>
              </div>
            </div>

            <div className="min-w-0 rounded-xl border border-[color:var(--pf-border-soft)] p-2 lg:order-1">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <button
                  type="button"
                  onClick={() => setVisibleMonth((current) => addCalendarMonths(current, -1))}
                  className="pf-workspace-date-nav inline-flex h-8 w-8 items-center justify-center rounded-lg border transition"
                  aria-label={t("statusPage.previousMonth")}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <div className="text-sm font-semibold text-[color:var(--pf-text)]">{monthLabel}</div>
                <button
                  type="button"
                  onClick={() => setVisibleMonth((current) => addCalendarMonths(current, 1))}
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
      </FloatingSurface>
    </div>
  );
}
