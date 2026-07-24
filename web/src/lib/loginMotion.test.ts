/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachLoginMotionLifecycle, LOGIN_MOTION_DATASET, LOGIN_MOTION_PAUSED } from "./loginMotion";

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

function motionState(): string | undefined {
  return document.documentElement.dataset[LOGIN_MOTION_DATASET];
}

describe("attachLoginMotionLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete document.documentElement.dataset[LOGIN_MOTION_DATASET];
  });

  it("pauses ambient motion after the idle window elapses", () => {
    const lifecycle = attachLoginMotionLifecycle(8000);
    expect(motionState()).toBeUndefined();

    vi.advanceTimersByTime(7999);
    expect(motionState()).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(motionState()).toBe(LOGIN_MOTION_PAUSED);
    lifecycle.dispose();
  });

  it("resumes on pointer activity and restarts the idle window", () => {
    const lifecycle = attachLoginMotionLifecycle(8000);
    vi.advanceTimersByTime(8000);
    expect(motionState()).toBe(LOGIN_MOTION_PAUSED);

    document.dispatchEvent(new PointerEvent("pointermove"));
    expect(motionState()).toBeUndefined();

    vi.advanceTimersByTime(7999);
    expect(motionState()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(motionState()).toBe(LOGIN_MOTION_PAUSED);
    lifecycle.dispose();
  });

  it("pauses immediately when the document becomes hidden and resumes when visible", () => {
    const lifecycle = attachLoginMotionLifecycle(8000);

    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(motionState()).toBe(LOGIN_MOTION_PAUSED);

    // Input while hidden must not resume motion.
    document.dispatchEvent(new PointerEvent("pointermove"));
    expect(motionState()).toBe(LOGIN_MOTION_PAUSED);

    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(motionState()).toBeUndefined();
    lifecycle.dispose();
  });

  it("clears the paused state and listeners on dispose", () => {
    const lifecycle = attachLoginMotionLifecycle(8000);
    vi.advanceTimersByTime(8000);
    expect(motionState()).toBe(LOGIN_MOTION_PAUSED);

    lifecycle.dispose();
    expect(motionState()).toBeUndefined();

    vi.advanceTimersByTime(16000);
    expect(motionState()).toBeUndefined();
  });
});
