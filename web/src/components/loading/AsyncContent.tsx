import { createContext, useContext, type ReactNode } from "react";

import {
  asyncRefreshFeedback,
  asyncViewIsBusy,
  asyncViewPhase,
  type AsyncRefreshIntent,
  type AsyncViewState,
} from "../../lib/asyncViewState";

interface AsyncContentProps {
  state: AsyncViewState;
  refreshIntent?: AsyncRefreshIntent;
  loadingLabel: string;
  skeleton: ReactNode;
  initialError: ReactNode;
  paused: ReactNode;
  empty: ReactNode;
  children: ReactNode;
  inactive?: ReactNode;
  initialIdle?: ReactNode;
  refreshFeedback?: ReactNode;
  className?: string;
}

type AsyncLiveRegion = "assertive" | "polite" | "off";

const AsyncFeedbackLiveRegionContext = createContext<AsyncLiveRegion | null>(null);

export function AsyncContent({
  state,
  refreshIntent = "background",
  loadingLabel,
  skeleton,
  initialError,
  paused,
  empty,
  children,
  inactive = null,
  initialIdle,
  refreshFeedback,
  className,
}: AsyncContentProps) {
  const phase = asyncViewPhase(state);
  const busy = asyncViewIsBusy(state, refreshIntent);

  if (phase === "inactive") {
    return inactive;
  }
  if (phase === "initial-error") {
    return <div aria-busy={busy || undefined}>{initialError}</div>;
  }
  if (phase === "paused") {
    return paused;
  }
  if (phase === "loading") {
    return (
      <div className={className} role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">{loadingLabel}</span>
        <div aria-hidden="true">{skeleton}</div>
      </div>
    );
  }
  if (phase === "initial-idle") {
    return initialIdle ?? initialError;
  }

  const content = phase === "empty" ? empty : children;
  const feedback = asyncRefreshFeedback(state, refreshIntent);

  return (
    <div className={className} aria-busy={busy || undefined}>
      {content}
      {feedback === "none" ? null : (
        <AsyncFeedbackLiveRegionContext.Provider value="off">
          {refreshFeedback}
        </AsyncFeedbackLiveRegionContext.Provider>
      )}
    </div>
  );
}

interface AsyncErrorStateProps {
  title: string;
  message?: string;
  retryLabel?: string;
  retryingLabel?: string;
  retrying?: boolean;
  onRetry?: () => void;
  className?: string;
  liveRegion?: AsyncLiveRegion;
}

export function AsyncErrorState({
  title,
  message,
  retryLabel,
  retryingLabel,
  retrying = false,
  onRetry,
  className,
  liveRegion,
}: AsyncErrorStateProps) {
  const inheritedLiveRegion = useContext(AsyncFeedbackLiveRegionContext);
  const resolvedLiveRegion = liveRegion ?? inheritedLiveRegion ?? "assertive";

  return (
    <div
      className={`pf-async-error ${className ?? "rounded-xl border px-4 py-3 text-sm"}`}
      role={resolvedLiveRegion === "assertive" ? "alert" : "status"}
      aria-live={resolvedLiveRegion}
    >
      <div className="font-semibold">{title}</div>
      {message ? <p className="mt-1 leading-6">{message}</p> : null}
      {onRetry && retryLabel ? (
        <button
          type="button"
          className="mt-3 inline-flex min-h-9 items-center rounded-md border border-current px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? retryingLabel ?? retryLabel : retryLabel}
        </button>
      ) : null}
    </div>
  );
}

interface AsyncPausedStateProps {
  title: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
  liveRegion?: AsyncLiveRegion;
}

export function AsyncPausedState({
  title,
  message,
  retryLabel,
  onRetry,
  className,
  liveRegion,
}: AsyncPausedStateProps) {
  const inheritedLiveRegion = useContext(AsyncFeedbackLiveRegionContext);
  const resolvedLiveRegion = liveRegion ?? inheritedLiveRegion ?? "polite";

  return (
    <div
      className={`pf-async-paused ${className ?? "rounded-xl border px-4 py-3 text-sm"}`}
      role={resolvedLiveRegion === "assertive" ? "alert" : "status"}
      aria-live={resolvedLiveRegion}
    >
      <div className="font-semibold">{title}</div>
      {message ? <p className="mt-1 leading-6">{message}</p> : null}
      {onRetry && retryLabel ? (
        <button
          type="button"
          className="mt-3 inline-flex min-h-9 items-center rounded-md border border-current px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
