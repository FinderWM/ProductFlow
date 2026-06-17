import { describe, expect, it } from "vitest";

import {
  composeDateTimeLocalSecondValue,
  removeWorkspaceTimePart,
  replaceWorkspaceTimePart,
  selectWorkspaceDateRangeDay,
  shiftWorkspaceTimePart,
  workspaceCalendarMonthDays,
  workspaceTimePartOptions,
} from "./WorkspaceDateTimeRangeField";

describe("WorkspaceDateTimeRangeField helpers", () => {
  it("composes datetime-local values with seconds", () => {
    expect(composeDateTimeLocalSecondValue("2026-06-14", "09:07", "00:00:00")).toBe("2026-06-14T09:07:00");
    expect(composeDateTimeLocalSecondValue("2026-06-14", "09:07:32", "00:00:00")).toBe(
      "2026-06-14T09:07:32",
    );
    expect(composeDateTimeLocalSecondValue("2026-06-14", "", "23:59:59")).toBe("2026-06-14T23:59:59");
    expect(composeDateTimeLocalSecondValue("", "09:07", "00:00:00")).toBe("");
  });

  it("builds a Monday-first six-week month grid", () => {
    const days = workspaceCalendarMonthDays(new Date(2026, 6, 1), new Date(2026, 6, 4));

    expect(days).toHaveLength(42);
    expect(days[0]).toMatchObject({ date: "2026-06-29", currentMonth: false });
    expect(days[2]).toMatchObject({ date: "2026-07-01", currentMonth: true });
    expect(days[5]).toMatchObject({ date: "2026-07-04", today: true });
    expect(days[41]).toMatchObject({ date: "2026-08-09", currentMonth: false });
  });

  it("normalizes custom time segments without native picker values", () => {
    expect(replaceWorkspaceTimePart("08:09:10", "hour", "27")).toBe("23:09:10");
    expect(replaceWorkspaceTimePart("08:09:10", "minute", "99")).toBe("08:59:10");
    expect(replaceWorkspaceTimePart("08:09:10", "second", "4")).toBe("08:09:04");
    expect(replaceWorkspaceTimePart("08:09:10", "second", "")).toBe("08:09:00");
  });

  it("shifts custom time segments with wrapping bounds", () => {
    expect(shiftWorkspaceTimePart("23:59:59", "hour", 1)).toBe("00:59:59");
    expect(shiftWorkspaceTimePart("00:00:00", "minute", -1)).toBe("00:59:00");
    expect(shiftWorkspaceTimePart("00:00:59", "second", 1)).toBe("00:00:00");
  });

  it("removes only the time part from a selected date", () => {
    expect(removeWorkspaceTimePart("2026-06-17T23:38:35")).toBe("2026-06-17");
    expect(removeWorkspaceTimePart("2026-06-17")).toBe("2026-06-17");
  });

  it("starts a new range after selecting an end date", () => {
    const completed = selectWorkspaceDateRangeDay(
      { start_date: "2026-06-11", end_date: "2026-06-11" },
      "end",
      "2026-06-12",
    );
    expect(completed).toEqual({
      range: { start_date: "2026-06-11", end_date: "2026-06-12" },
      activeBoundary: "start",
    });

    const sameDay = selectWorkspaceDateRangeDay(completed.range, completed.activeBoundary, "2026-06-12");
    expect(sameDay).toEqual({
      range: { start_date: "2026-06-12", end_date: "2026-06-12" },
      activeBoundary: "end",
    });
  });

  it("preserves boundary time when starting a new same-day range", () => {
    const sameDay = selectWorkspaceDateRangeDay(
      { start_date: "2026-06-11T08:30:00", end_date: "2026-06-12T20:15:30" },
      "start",
      "2026-06-12",
    );

    expect(sameDay.range).toEqual({
      start_date: "2026-06-12T08:30:00",
      end_date: "2026-06-12T20:15:30",
    });
    expect(sameDay.activeBoundary).toBe("end");
  });

  it("builds bounded options for each time column", () => {
    expect(workspaceTimePartOptions("hour")).toHaveLength(24);
    expect(workspaceTimePartOptions("hour").at(0)).toBe("00");
    expect(workspaceTimePartOptions("hour").at(-1)).toBe("23");
    expect(workspaceTimePartOptions("minute")).toHaveLength(60);
    expect(workspaceTimePartOptions("second").at(-1)).toBe("59");
  });
});
