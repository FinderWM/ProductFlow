import { describe, expect, it } from "vitest";

import { dynamicFieldsToRecord, parseDynamicScalar } from "./dynamicFields";

describe("dynamic field helpers", () => {
  it("parses scalar strings for inspiration context dynamic fields", () => {
    expect(parseDynamicScalar("true")).toBe(true);
    expect(parseDynamicScalar("false")).toBe(false);
    expect(parseDynamicScalar("null")).toBeNull();
    expect(parseDynamicScalar("12.5")).toBe(12.5);
    expect(parseDynamicScalar("001")).toBe("001");
    expect(parseDynamicScalar(" warm ")).toBe(" warm ");
  });

  it("builds records and ignores fully blank keys", () => {
    expect(
      dynamicFieldsToRecord([
        { key: " enabled ", value: "true" },
        { key: "stock", value: "12" },
        { key: "", value: "ignored" },
      ]),
    ).toEqual({ enabled: true, stock: 12 });
  });
});
