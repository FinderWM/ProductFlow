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
  WORKSPACE_CURSOR_X_PROPERTY,
  WORKSPACE_CURSOR_Y_PROPERTY,
  workspacePointerCssValues,
} from "./workspaceMotion";
import { workspaceAppearanceResolvedTheme } from "./workspaceAppearance";

interface UiLayoutSchemeContextValue {
  activeScheme: UiLayoutScheme;
  defaultScheme: UiLayoutScheme;
  setActiveScheme: (scheme: UiLayoutScheme) => void;
  saveDefaultScheme: (scheme: UiLayoutScheme) => void;
  isLoadingDefaultScheme: boolean;
  isSavingDefaultScheme: boolean;
}

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
  });

  const defaultScheme = resolveUiLayoutSchemePreference(preferencesQuery.data);

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
    if (activeScheme !== "workspace") {
      clearWorkspacePointerVars(root);
      return;
    }

    const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)");
    let frameId = 0;
    let lastPointer: PointerEvent | null = null;
    let listening = false;

    const applyPointerVars = () => {
      frameId = 0;
      if (!lastPointer) {
        return;
      }
      const values = workspacePointerCssValues(lastPointer.clientX, lastPointer.clientY, workspacePointerViewport());
      root.style.setProperty(WORKSPACE_CURSOR_X_PROPERTY, values.x);
      root.style.setProperty(WORKSPACE_CURSOR_Y_PROPERTY, values.y);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }
      lastPointer = event;
      if (frameId === 0) {
        frameId = window.requestAnimationFrame(applyPointerVars);
      }
    };

    const stopListening = () => {
      if (!listening) {
        clearWorkspacePointerVars(root);
        return;
      }
      document.removeEventListener("pointermove", handlePointerMove);
      listening = false;
      lastPointer = null;
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      clearWorkspacePointerVars(root);
    };

    const startListening = () => {
      if (listening) {
        return;
      }
      document.addEventListener("pointermove", handlePointerMove, { passive: true });
      listening = true;
    };

    const syncPointerMode = () => {
      if (finePointer && !finePointer.matches) {
        stopListening();
        return;
      }
      startListening();
    };

    syncPointerMode();
    finePointer?.addEventListener("change", syncPointerMode);

    return () => {
      finePointer?.removeEventListener("change", syncPointerMode);
      stopListening();
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

  const value = useMemo<UiLayoutSchemeContextValue>(
    () => ({
      activeScheme,
      defaultScheme,
      setActiveScheme,
      saveDefaultScheme,
      isLoadingDefaultScheme: preferencesQuery.isLoading,
      isSavingDefaultScheme: updateMutation.isPending,
    }),
    [
      activeScheme,
      defaultScheme,
      preferencesQuery.isLoading,
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
    setActiveScheme: () => undefined,
    saveDefaultScheme: () => undefined,
    isLoadingDefaultScheme: false,
    isSavingDefaultScheme: false,
  };
}
