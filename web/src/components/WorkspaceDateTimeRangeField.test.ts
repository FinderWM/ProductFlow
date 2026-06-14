import { describe, expect, it } from "vitest";

import {
  composeDateTimeLocalSecondValue,
  replaceWorkspaceTimePart,
  shiftWorkspaceTimePart,
  workspaceCalendarMonthDays,
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
});
