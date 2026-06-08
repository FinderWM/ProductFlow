import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_AUTO_CLOSE_MS,
  MAX_NOTIFICATION_AUTO_CLOSE_MS,
  MIN_NOTIFICATION_AUTO_CLOSE_MS,
  normalizeNotificationAutoCloseMs,
} from "./notifications";

describe("normalizeNotificationAutoCloseMs", () => {
  it("keeps auto-close duration inside the supported range", () => {
    expect(normalizeNotificationAutoCloseMs("bad")).toBe(DEFAULT_NOTIFICATION_AUTO_CLOSE_MS);
    expect(normalizeNotificationAutoCloseMs(200)).toBe(MIN_NOTIFICATION_AUTO_CLOSE_MS);
    expect(normalizeNotificationAutoCloseMs(120000)).toBe(MAX_NOTIFICATION_AUTO_CLOSE_MS);
    expect(normalizeNotificationAutoCloseMs(5500.4)).toBe(5500);
  });
});
