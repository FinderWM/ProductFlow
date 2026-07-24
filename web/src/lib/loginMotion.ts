import { useEffect } from "react";

/** Root dataset key toggled while the login page is idle or hidden. */
export const LOGIN_MOTION_DATASET = "loginMotion";

/** Root dataset value while ambient login animations stay paused. */
export const LOGIN_MOTION_PAUSED = "paused";

/** Pause ambient login animations after this much input idle time. */
export const LOGIN_MOTION_IDLE_MS = 8000;

const LOGIN_ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "touchstart"] as const;

export interface LoginMotionLifecycle {
  dispose: () => void;
}

/**
 * Pause ambient (infinite) login animations once the page is hidden or no
 * pointer/keyboard/touch input arrives for `idleMs`; resume on the next input.
 * CSS keys off `:root[data-login-motion="paused"]` in `LoginPage.css`.
 */
export function attachLoginMotionLifecycle(idleMs = LOGIN_MOTION_IDLE_MS): LoginMotionLifecycle {
  const root = document.documentElement;
  let idleTimer = 0;

  const setPaused = (paused: boolean) => {
    if (paused) {
      root.dataset[LOGIN_MOTION_DATASET] = LOGIN_MOTION_PAUSED;
    } else {
      delete root.dataset[LOGIN_MOTION_DATASET];
    }
  };

  const disarmIdleTimer = () => {
    if (idleTimer !== 0) {
      window.clearTimeout(idleTimer);
      idleTimer = 0;
    }
  };

  const armIdleTimer = () => {
    disarmIdleTimer();
    idleTimer = window.setTimeout(() => {
      idleTimer = 0;
      setPaused(true);
    }, Math.max(0, idleMs));
  };

  const handleActivity = () => {
    if (!document.hidden) {
      setPaused(false);
    }
    armIdleTimer();
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      disarmIdleTimer();
      setPaused(true);
      return;
    }
    setPaused(false);
    armIdleTimer();
  };

  LOGIN_ACTIVITY_EVENTS.forEach((type) => document.addEventListener(type, handleActivity, { passive: true }));
  document.addEventListener("visibilitychange", handleVisibilityChange);
  armIdleTimer();

  return {
    dispose: () => {
      disarmIdleTimer();
      LOGIN_ACTIVITY_EVENTS.forEach((type) => document.removeEventListener(type, handleActivity));
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      delete root.dataset[LOGIN_MOTION_DATASET];
    },
  };
}

/** React binding: active while a login template is mounted. */
export function useLoginMotionLifecycle(idleMs = LOGIN_MOTION_IDLE_MS): void {
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return undefined;
    }
    const lifecycle = attachLoginMotionLifecycle(idleMs);
    return () => lifecycle.dispose();
  }, [idleMs]);
}
