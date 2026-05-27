import { createContext, useContext } from "react";

import type { SessionState } from "./types";

const SessionStateContext = createContext<SessionState | null>(null);

export const SessionStateProvider = SessionStateContext.Provider;

export function useSessionState(): SessionState | null {
  return useContext(SessionStateContext);
}
