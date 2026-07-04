import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface TopNavStateContextValue {
  workspaceThemeDockOpen: boolean;
  setWorkspaceThemeDockOpen: (open: boolean) => void;
}

const DEFAULT_WORKSPACE_THEME_DOCK_OPEN = true;
const TopNavStateContext = createContext<TopNavStateContextValue | null>(null);

export function TopNavStateProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [workspaceThemeDockOpen, setWorkspaceThemeDockOpenState] = useState(DEFAULT_WORKSPACE_THEME_DOCK_OPEN);

  useEffect(() => {
    if (enabled) {
      return;
    }
    setWorkspaceThemeDockOpenState(DEFAULT_WORKSPACE_THEME_DOCK_OPEN);
  }, [enabled]);

  const setWorkspaceThemeDockOpen = useCallback((open: boolean) => {
    setWorkspaceThemeDockOpenState(open);
  }, []);

  const value = useMemo<TopNavStateContextValue>(
    () => ({
      workspaceThemeDockOpen,
      setWorkspaceThemeDockOpen,
    }),
    [workspaceThemeDockOpen, setWorkspaceThemeDockOpen],
  );

  return <TopNavStateContext.Provider value={value}>{children}</TopNavStateContext.Provider>;
}

export function useTopNavState(): TopNavStateContextValue {
  const context = useContext(TopNavStateContext);
  if (context) {
    return context;
  }
  return {
    workspaceThemeDockOpen: DEFAULT_WORKSPACE_THEME_DOCK_OPEN,
    setWorkspaceThemeDockOpen: () => undefined,
  };
}
