import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { useUiLayoutScheme } from "../../lib/uiLayoutSchemePreference";
import {
  RouteChunkLoadError,
  matchPageRoute,
  pageRouteRequiresResolvedScheme,
  resolvePageModule,
  resolvePageSkeletonProfile,
  resolveUnresolvedSchemeSkeletonProfile,
} from "../../routes/pageModules";
import { LayoutSchemeResolvingSkeleton, PageLoadingSkeleton } from "./PageLoadingSkeleton";

interface RouteErrorBoundaryProps {
  resetKey: string;
  children: ReactNode;
  chunkErrorTitle: string;
  chunkErrorMessage: string;
  reloadLabel: string;
  renderErrorTitle: string;
  renderErrorMessage: string;
  retryLabel: string;
  onReload?: () => void;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private readonly reset = () => {
    this.setState({ error: null });
  };

  private readonly reload = () => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const chunkFailure = error instanceof RouteChunkLoadError;
    const title = chunkFailure ? this.props.chunkErrorTitle : this.props.renderErrorTitle;
    const message = chunkFailure ? this.props.chunkErrorMessage : this.props.renderErrorMessage;
    const actionLabel = chunkFailure ? this.props.reloadLabel : this.props.retryLabel;

    return (
      <main className="flex min-h-[calc(100svh-4rem)] items-center justify-center bg-[color:var(--pf-bg)] px-5 py-10">
        <section
          className="w-full max-w-lg rounded-2xl border pf-hairline pf-surface p-6 text-[color:var(--pf-text)] shadow-[var(--pf-shadow)]"
          role="alert"
        >
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-2 text-sm leading-6 pf-ink-muted">{message}</p>
          <button
            type="button"
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-md border pf-hairline-strong pf-surface-soft px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pf-accent)]"
            onClick={chunkFailure ? this.reload : this.reset}
          >
            {actionLabel}
          </button>
        </section>
      </main>
    );
  }
}

interface RouteLoadingBoundaryProps extends Omit<RouteErrorBoundaryProps, "children" | "resetKey"> {
  children: ReactNode;
  loadingLabel: string;
  layoutResolvingLabel: string;
}

export function RouteLoadingBoundary({
  children,
  loadingLabel,
  layoutResolvingLabel,
  ...errorProps
}: RouteLoadingBoundaryProps) {
  const location = useLocation();
  const { activeScheme, resolutionStatus } = useUiLayoutScheme();
  const route = matchPageRoute(location.pathname);
  const loader = resolvePageModule(location.pathname, activeScheme);
  const profile = resolvePageSkeletonProfile(location.pathname, activeScheme);
  const resolvingProfile = resolveUnresolvedSchemeSkeletonProfile(location.pathname);
  const locationKey = location.key || `${location.pathname}${location.search}`;
  const resetKey = `${locationKey}:${activeScheme}:${route.id}:${loader.key}`;

  if (resolutionStatus === "resolving" && pageRouteRequiresResolvedScheme(location.pathname)) {
    return <LayoutSchemeResolvingSkeleton label={layoutResolvingLabel} profile={resolvingProfile} />;
  }

  return (
    <RouteErrorBoundary resetKey={resetKey} {...errorProps}>
      <Suspense fallback={<PageLoadingSkeleton profile={profile} label={loadingLabel} />}>
        {children}
      </Suspense>
    </RouteErrorBoundary>
  );
}
