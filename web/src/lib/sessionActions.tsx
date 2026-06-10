import { createContext, useContext, type ReactNode } from "react";

interface SessionActions {
  logout?: () => void;
}

const SessionActionsContext = createContext<SessionActions>({});

export function SessionActionsProvider({ children, value }: { children: ReactNode; value: SessionActions }) {
  return <SessionActionsContext.Provider value={value}>{children}</SessionActionsContext.Provider>;
}

export function useSessionActions(): SessionActions {
  return useContext(SessionActionsContext);
}
