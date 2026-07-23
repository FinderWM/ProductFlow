import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { usePreferences } from "./preferences";
import {
  DEFAULT_SENSITIVE_IMAGE_MASK_ENABLED,
  USER_UI_PREFERENCES_QUERY_KEY,
} from "./sensitiveImagePreferences";
import type { UserUiPreferences } from "./types";
import {
  DEFAULT_UI_LAYOUT_SCHEME,
  type UiLayoutScheme,
  resolveUiLayoutScheme,
  resolveUiLayoutSchemePreference,
  uiLayoutSchemePreferenceUpdate,
} from "./uiLayoutScheme";
import {
  WORKSPACE_AMBIENT_GLOW_CLASS,
  WORKSPACE_AMBIENT_IDLE_MS,
  WORKSPACE_CURSOR_X_PROPERTY,
  WORKSPACE_CURSOR_Y_PROPERTY,
  WORKSPACE_DOCUMENT_MOTION_DATASET,
  workspaceAmbientGlowTransform,
  workspaceAmbientPointerOnBackground,
  workspaceDocumentMotionState,
  workspacePointerCssValues,
} from "./workspaceMotion";
import { workspaceAppearanceResolvedTheme } from "./workspaceAppearance";

interface UiLayoutSchemeContextValue {
  activeScheme: UiLayoutScheme;
  defaultScheme: UiLayoutScheme;
  resolutionStatus: UiLayoutSchemeResolutionStatus;
  setActiveScheme: (scheme: UiLayoutScheme) => void;
  saveDefaultScheme: (scheme: UiLayoutScheme) => void;
  retryDefaultScheme: () => void;
  isLoadingDefaultScheme: boolean;
  isSavingDefaultScheme: boolean;
}

export type UiLayoutSchemeResolutionStatus = "disabled" | "resolving" | "resolved" | "fallback-error";

const UiLayoutSchemeContext = createContext<UiLayoutSchemeContextValue | null>(null);

export function fallbackUserUiPreferences(scheme: UiLayoutScheme = DEFAULT_UI_LAYOUT_SCHEME): UserUiPreferences {
  return {
    user_id: "",
    ui_layout_scheme: scheme,
    mask_sensitive_images_in_inspirations: DEFAULT_SENSITIVE_IMAGE_MASK_ENABLED,
    mask_sensitive_images_in_image_chat: DEFAULT_SENSITIVE_IMAGE_MASK_ENABLED,
    created_at: "",
    updated_at: "",
  };
}

export function mergeUiLayoutSchemePreference(
  preferences: UserUiPreferences | null | undefined,
  scheme: UiLayoutScheme,
): UserUiPreferences {
  return {
    ...(preferences ?? fallbackUserUiPreferences(scheme)),
    ui_layout_scheme: scheme,
  };
}

export function resolveActiveSchemeFromDefaultLoad({
  enabled,
  initializedFromDefault,
  hasPreferencesData,
  activeScheme,
  defaultScheme,
}: {
  enabled: boolean;
  initializedFromDefault: boolean;
  hasPreferencesData: boolean;
  activeScheme: UiLayoutScheme;
  defaultScheme: UiLayoutScheme;
}): { activeScheme: UiLayoutScheme; initializedFromDefault: boolean } {
  if (!enabled) {
    return {
      activeScheme: DEFAULT_UI_LAYOUT_SCHEME,
      initializedFromDefault: false,
    };
  }
  if (initializedFromDefault || !hasPreferencesData) {
    return { activeScheme, initializedFromDefault };
  }
  return {
    activeScheme: defaultScheme,
    initializedFromDefault: true,
  };
}

export function resolveActiveSchemeAfterDefaultSaveError({
  currentScheme,
  attemptedScheme,
  previousActiveScheme,
}: {
  currentScheme: UiLayoutScheme;
  attemptedScheme: UiLayoutScheme;
  previousActiveScheme: UiLayoutScheme;
}): UiLayoutScheme {
  return currentScheme === attemptedScheme ? previousActiveScheme : currentScheme;
}

export function resolveUiLayoutSchemeResolutionStatus({
  enabled,
  initializedFromDefault,
  hasPreferencesData,
  hasInitialError,
}: {
  enabled: boolean;
  initializedFromDefault: boolean;
  hasPreferencesData: boolean;
  hasInitialError: boolean;
}): UiLayoutSchemeResolutionStatus {
  if (!enabled) {
    return "disabled";
  }
  if (hasPreferencesData && initializedFromDefault) {
    return "resolved";
  }
  if (hasInitialError && !hasPreferencesData) {
    return "fallback-error";
  }
  return "resolving";
}

function workspacePointerViewport(): { width: number; height: number; offsetLeft: number; offsetTop: number } {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    offsetLeft: viewport?.offsetLeft ?? 0,
    offsetTop: viewport?.offsetTop ?? 0,
  };
}

function clearWorkspacePointerVars(root: HTMLElement) {
  root.style.removeProperty(WORKSPACE_CURSOR_X_PROPERTY);
  root.style.removeProperty(WORKSPACE_CURSOR_Y_PROPERTY);
}

function removeWorkspaceAmbientGlow(node: HTMLElement | null) {
  node?.remove();
}

/**
 * Glow must live inside the opaque workspace shell so z-index:-1 sits above the shell
 * background but below page content. Mounting under #root paints under .pf-workspace and is invisible.
 */
function workspaceAmbientHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".pf-workspace, .pf-app");
}

function ensureWorkspaceAmbientGlow(): HTMLElement | null {
  const host = workspaceAmbientHost();
  if (!host) {
    return null;
  }
  const existing = host.querySelector<HTMLElement>(`.${WORKSPACE_AMBIENT_GLOW_CLASS}`);
  if (existing) {
    return existing;
  }
  // Drop any stale glow left under #root / body from earlier hosts.
  document.querySelectorAll<HTMLElement>(`.${WORKSPACE_AMBIENT_GLOW_CLASS}`).forEach((node) => {
    if (node.parentElement !== host) {
      node.remove();
    }
  });
  const glow = document.createElement("div");
  glow.className = WORKSPACE_AMBIENT_GLOW_CLASS;
  glow.setAttribute("aria-hidden", "true");
  host.insertBefore(glow, host.firstChild);
  return glow;
}

export function UiLayoutSchemeProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const { setThemePreference, workspaceAppearance } = usePreferences();
  const [initializedFromDefault, setInitializedFromDefault] = useState(false);
  const [activeScheme, setActiveSchemeState] = useState<UiLayoutScheme>(DEFAULT_UI_LAYOUT_SCHEME);
  const activeSchemeRef = useRef<UiLayoutScheme>(DEFAULT_UI_LAYOUT_SCHEME);

  const preferencesQuery = useQuery({
    queryKey: USER_UI_PREFERENCES_QUERY_KEY,
    queryFn: api.getUserUiPreferences,
    enabled,
    retry: 1,
  });

  const defaultScheme = resolveUiLayoutSchemePreference(preferencesQuery.data);
  const resolutionStatus = resolveUiLayoutSchemeResolutionStatus({
    enabled,
    initializedFromDefault,
    hasPreferencesData: preferencesQuery.data !== undefined,
    hasInitialError: preferencesQuery.isError,
  });

  useEffect(() => {
    const nextState = resolveActiveSchemeFromDefaultLoad({
      enabled,
      initializedFromDefault,
      hasPreferencesData: Boolean(preferencesQuery.data),
      activeScheme,
      defaultScheme,
    });
    if (nextState.activeScheme !== activeScheme) {
      activeSchemeRef.current = nextState.activeScheme;
      setActiveSchemeState(nextState.activeScheme);
    }
    if (nextState.initializedFromDefault !== initializedFromDefault) {
      setInitializedFromDefault(nextState.initializedFromDefault);
    }
  }, [activeScheme, defaultScheme, enabled, initializedFromDefault, preferencesQuery.data]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.uiLayoutScheme = activeScheme;
  }, [activeScheme]);

  useEffect(() => {
    if (activeScheme !== "workspace") {
      return;
    }
    setThemePreference(workspaceAppearanceResolvedTheme(workspaceAppearance));
  }, [activeScheme, setThemePreference, workspaceAppearance]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const root = document.documentElement;
    // Legacy root CSS vars must not drive ambient motion — they invalidate inherited style broadly.
    clearWorkspacePointerVars(root);

    if (activeScheme !== "workspace") {
      delete root.dataset[WORKSPACE_DOCUMENT_MOTION_DATASET];
      document.querySelectorAll<HTMLElement>(`.${WORKSPACE_AMBIENT_GLOW_CLASS}`).forEach((node) => node.remove());
      return;
    }

    const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)");
    let frameId = 0;
    let idleTimer = 0;
    let lastPointer: PointerEvent | null = null;
    let lastAppliedTransform = "";
    let listening = false;
    let glow: HTMLElement | null = null;

    const setDocumentMotionState = () => {
      root.dataset[WORKSPACE_DOCUMENT_MOTION_DATASET] = workspaceDocumentMotionState(document.hidden);
    };

    const setGlowWillChange = (active: boolean) => {
      if (!glow?.isConnected) {
        return;
      }
      glow.style.willChange = active ? "transform" : "auto";
    };

    const markGlowActive = () => {
      setGlowWillChange(true);
      if (idleTimer !== 0) {
        window.clearTimeout(idleTimer);
      }
      idleTimer = window.setTimeout(() => {
        idleTimer = 0;
        setGlowWillChange(false);
      }, WORKSPACE_AMBIENT_IDLE_MS);
    };

    const disposeGlow = () => {
      if (idleTimer !== 0) {
        window.clearTimeout(idleTimer);
        idleTimer = 0;
      }
      removeWorkspaceAmbientGlow(glow);
      document.querySelectorAll<HTMLElement>(`.${WORKSPACE_AMBIENT_GLOW_CLASS}`).forEach((node) => node.remove());
      glow = null;
      lastAppliedTransform = "";
    };

    const resolveGlow = () => {
      if (glow?.isConnected) {
        return glow;
      }
      glow = ensureWorkspaceAmbientGlow();
      lastAppliedTransform = "";
      if (glow) {
        glow.style.willChange = "auto";
      }
      return glow;
    };

    const applyAmbientTransform = () => {
      frameId = 0;
      if (!lastPointer || document.hidden) {
        return;
      }
      const target = resolveGlow();
      if (!target) {
        return;
      }
      const values = workspacePointerCssValues(lastPointer.clientX, lastPointer.clientY, workspacePointerViewport());
      const nextTransform = workspaceAmbientGlowTransform(values);
      // Direct element transform only — avoid root custom properties.
      if (nextTransform === lastAppliedTransform) {
        return;
      }
      lastAppliedTransform = nextTransform;
      target.style.transform = nextTransform;
      markGlowActive();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || document.hidden) {
        return;
      }
      // Only follow when the pointer hits bare shell background, not page UI layers.
      if (!workspaceAmbientPointerOnBackground(event.target, workspaceAmbientHost())) {
        return;
      }
      lastPointer = event;
      if (frameId === 0) {
        frameId = window.requestAnimationFrame(applyAmbientTransform);
      }
    };

    let hostRetryId = 0;

    const stopListening = ({ dispose = true }: { dispose?: boolean } = {}) => {
      if (listening) {
        document.removeEventListener("pointermove", handlePointerMove);
        listening = false;
      }
      lastPointer = null;
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      if (hostRetryId !== 0) {
        window.cancelAnimationFrame(hostRetryId);
        hostRetryId = 0;
      }
      if (idleTimer !== 0) {
        window.clearTimeout(idleTimer);
        idleTimer = 0;
      }
      if (dispose) {
        disposeGlow();
      } else {
        setGlowWillChange(false);
      }
      clearWorkspacePointerVars(root);
    };

    const startListening = () => {
      if (listening || document.hidden) {
        return;
      }
      glow = ensureWorkspaceAmbientGlow();
      if (glow) {
        glow.style.willChange = "auto";
      }
      document.addEventListener("pointermove", handlePointerMove, { passive: true });
      listening = true;
      // Lazy routes may mount .pf-workspace after this effect; retry until shell exists.
      if (!glow && hostRetryId === 0) {
        let attempts = 0;
        const retryHost = () => {
          hostRetryId = 0;
          if (!listening || glow?.isConnected || document.hidden) {
            return;
          }
          glow = ensureWorkspaceAmbientGlow();
          if (glow) {
            glow.style.willChange = "auto";
          }
          if (!glow && attempts++ < 90) {
            hostRetryId = window.requestAnimationFrame(retryHost);
          }
        };
        hostRetryId = window.requestAnimationFrame(retryHost);
      }
    };

    const syncPointerMode = () => {
      if (document.hidden) {
        stopListening({ dispose: false });
        return;
      }
      if (finePointer && !finePointer.matches) {
        stopListening({ dispose: true });
        return;
      }
      startListening();
    };

    const handleVisibilityChange = () => {
      setDocumentMotionState();
      syncPointerMode();
    };

    setDocumentMotionState();
    syncPointerMode();
    finePointer?.addEventListener("change", syncPointerMode);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      finePointer?.removeEventListener("change", syncPointerMode);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (hostRetryId !== 0) {
        window.cancelAnimationFrame(hostRetryId);
        hostRetryId = 0;
      }
      stopListening({ dispose: true });
      delete root.dataset[WORKSPACE_DOCUMENT_MOTION_DATASET];
    };
  }, [activeScheme]);

  const updateMutation = useMutation({
    mutationFn: (scheme: UiLayoutScheme) => api.updateUserUiPreferences(uiLayoutSchemePreferenceUpdate(scheme)),
    onMutate: async (scheme: UiLayoutScheme) => {
      await queryClient.cancelQueries({ queryKey: USER_UI_PREFERENCES_QUERY_KEY });
      const previous = queryClient.getQueryData<UserUiPreferences>(USER_UI_PREFERENCES_QUERY_KEY);
      const previousActiveScheme = activeSchemeRef.current;
      queryClient.setQueryData<UserUiPreferences>(
        USER_UI_PREFERENCES_QUERY_KEY,
        mergeUiLayoutSchemePreference(previous, scheme),
      );
      activeSchemeRef.current = scheme;
      setActiveSchemeState(scheme);
      setInitializedFromDefault(true);
      return { previous, previousActiveScheme, attemptedScheme: scheme };
    },
    onError: (_error, scheme, context) => {
      if (context?.previous) {
        queryClient.setQueryData(USER_UI_PREFERENCES_QUERY_KEY, context.previous);
      } else {
        queryClient.setQueryData(USER_UI_PREFERENCES_QUERY_KEY, fallbackUserUiPreferences());
      }
      const attemptedScheme = context?.attemptedScheme ?? scheme;
      const previousActiveScheme = context?.previousActiveScheme ?? DEFAULT_UI_LAYOUT_SCHEME;
      setActiveSchemeState((currentScheme) => {
        const nextScheme = resolveActiveSchemeAfterDefaultSaveError({
          currentScheme,
          attemptedScheme,
          previousActiveScheme,
        });
        activeSchemeRef.current = nextScheme;
        return nextScheme;
      });
      setInitializedFromDefault(true);
    },
    onSuccess: (data) => {
      const nextScheme = resolveUiLayoutSchemePreference(data);
      queryClient.setQueryData(USER_UI_PREFERENCES_QUERY_KEY, data);
      activeSchemeRef.current = nextScheme;
      setActiveSchemeState(nextScheme);
      setInitializedFromDefault(true);
    },
  });

  const setActiveScheme = useCallback((scheme: UiLayoutScheme) => {
    const nextScheme = resolveUiLayoutScheme(scheme);
    activeSchemeRef.current = nextScheme;
    setActiveSchemeState(nextScheme);
    setInitializedFromDefault(true);
  }, []);

  const saveDefaultScheme = useCallback(
    (scheme: UiLayoutScheme) => {
      const nextScheme = resolveUiLayoutScheme(scheme);
      updateMutation.mutate(nextScheme);
    },
    [updateMutation],
  );

  const retryDefaultScheme = useCallback(() => {
    void preferencesQuery.refetch();
  }, [preferencesQuery]);

  const value = useMemo<UiLayoutSchemeContextValue>(
    () => ({
      activeScheme,
      defaultScheme,
      resolutionStatus,
      setActiveScheme,
      saveDefaultScheme,
      retryDefaultScheme,
      isLoadingDefaultScheme: preferencesQuery.isFetching,
      isSavingDefaultScheme: updateMutation.isPending,
    }),
    [
      activeScheme,
      defaultScheme,
      preferencesQuery.isFetching,
      resolutionStatus,
      retryDefaultScheme,
      saveDefaultScheme,
      setActiveScheme,
      updateMutation.isPending,
    ],
  );

  return <UiLayoutSchemeContext.Provider value={value}>{children}</UiLayoutSchemeContext.Provider>;
}

export function useUiLayoutScheme(): UiLayoutSchemeContextValue {
  const context = useContext(UiLayoutSchemeContext);
  if (context) {
    return context;
  }
  return {
    activeScheme: DEFAULT_UI_LAYOUT_SCHEME,
    defaultScheme: DEFAULT_UI_LAYOUT_SCHEME,
    resolutionStatus: "disabled",
    setActiveScheme: () => undefined,
    saveDefaultScheme: () => undefined,
    retryDefaultScheme: () => undefined,
    isLoadingDefaultScheme: false,
    isSavingDefaultScheme: false,
  };
}
