import { Skeleton, SkeletonCards, SkeletonMetrics, SkeletonRows, SkeletonText } from "./Skeleton";

export type PageSkeletonProfile =
  | "standard"
  | "list"
  | "grid"
  | "analytics"
  | "side-rail"
  | "workbench"
  | "workspace-landing"
  | "auth"
  | "auth-command-orbit"
  | "auth-fluid-mist"
  | "auth-image-lab";

interface PageLoadingSkeletonProps {
  profile: PageSkeletonProfile;
  label: string;
  includeNavigation?: boolean;
}

function NavigationSkeleton() {
  return (
    <header className="flex h-16 items-center gap-4 border-b pf-hairline pf-surface px-4 sm:px-6" aria-hidden="true">
      <Skeleton className="h-9 w-9" rounded="lg" />
      <Skeleton className="h-4 w-36" />
      <div className="ml-auto hidden items-center gap-3 md:flex">
        <Skeleton className="h-8 w-20" rounded="full" />
        <Skeleton className="h-8 w-20" rounded="full" />
        <Skeleton className="h-8 w-8" rounded="full" />
      </div>
    </header>
  );
}

function PageHeaderSkeleton() {
  return (
    <div className="mb-6 space-y-3" aria-hidden="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-64 max-w-3/4" />
      <Skeleton className="h-3 w-full max-w-xl opacity-70" />
    </div>
  );
}

function StandardSkeleton() {
  return (
    <main className="pf-page py-7">
      <PageHeaderSkeleton />
      <section className="rounded-xl border pf-hairline pf-surface p-5">
        <SkeletonText lines={5} />
      </section>
    </main>
  );
}

function ListSkeleton() {
  return (
    <main className="pf-page-wide py-7">
      <PageHeaderSkeleton />
      <section className="rounded-xl border pf-hairline pf-surface px-4">
        <SkeletonRows count={7} />
      </section>
    </main>
  );
}

function GridSkeleton() {
  return (
    <main className="pf-page-wide py-7">
      <PageHeaderSkeleton />
      <SkeletonCards />
    </main>
  );
}

function AnalyticsSkeleton() {
  return (
    <main className="pf-page-wide py-7">
      <PageHeaderSkeleton />
      <SkeletonMetrics count={6} />
      <section className="mt-5 rounded-xl border pf-hairline pf-surface px-4">
        <SkeletonRows count={6} />
      </section>
    </main>
  );
}

function SideRailSkeleton() {
  return (
    <main className="pf-page-wide grid gap-5 py-7 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="rounded-xl border pf-hairline pf-surface p-4" aria-hidden="true">
        <Skeleton className="h-6 w-32" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" rounded="lg" />
          ))}
        </div>
      </aside>
      <section className="min-w-0 rounded-xl border pf-hairline pf-surface p-5">
        <PageHeaderSkeleton />
        <SkeletonCards count={4} className="xl:grid-cols-2" />
      </section>
    </main>
  );
}

function WorkbenchSkeleton() {
  return (
    <main className="grid min-h-[calc(100svh-4rem)] grid-cols-1 gap-px bg-[color:var(--pf-border-soft)] lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
      <aside className="pf-surface p-4" aria-hidden="true">
        <Skeleton className="h-9 w-full" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" rounded="lg" />
          ))}
        </div>
      </aside>
      <section className="pf-surface-soft flex min-h-[32rem] items-center justify-center p-6" aria-hidden="true">
        <Skeleton className="aspect-[4/3] w-full max-w-3xl" rounded="lg" />
      </section>
      <aside className="pf-surface p-4" aria-hidden="true">
        <Skeleton className="h-5 w-2/5" />
        <div className="mt-5 space-y-4">
          <Skeleton className="h-20 w-full" rounded="lg" />
          <Skeleton className="h-10 w-full" rounded="lg" />
          <SkeletonText lines={4} />
        </div>
      </aside>
    </main>
  );
}

function WorkspaceLandingSkeleton() {
  return (
    <main className="pf-workspace min-h-[calc(100svh-4rem)] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <PageHeaderSkeleton />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-2xl border pf-hairline pf-surface p-5">
            <SkeletonRows count={4} />
            <SkeletonMetrics count={3} className="mt-5 xl:grid-cols-3" />
          </section>
          <Skeleton className="min-h-80 w-full" rounded="lg" />
        </div>
      </div>
    </main>
  );
}

function AuthSkeleton({ variant }: { variant: PageSkeletonProfile }) {
  const imageLab = variant === "auth-image-lab";
  return (
    <main className="grid min-h-screen bg-[color:var(--pf-bg)] lg:grid-cols-2">
      <section className="hidden p-8 lg:flex lg:items-center lg:justify-center" aria-hidden="true">
        <Skeleton className={imageLab ? "aspect-square w-full max-w-lg" : "h-[28rem] w-full max-w-lg"} rounded="lg" />
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border pf-hairline pf-surface p-6" aria-hidden="true">
          <Skeleton className="h-10 w-10" rounded="lg" />
          <Skeleton className="mt-5 h-7 w-3/5" />
          <SkeletonText className="mt-4" lines={2} />
          <Skeleton className="mt-8 h-11 w-full" rounded="lg" />
          <Skeleton className="mt-4 h-11 w-full" rounded="lg" />
        </div>
      </section>
    </main>
  );
}

function ProfileSkeleton({ profile }: { profile: PageSkeletonProfile }) {
  if (profile.startsWith("auth")) {
    return <AuthSkeleton variant={profile} />;
  }
  switch (profile) {
    case "list":
      return <ListSkeleton />;
    case "grid":
      return <GridSkeleton />;
    case "analytics":
      return <AnalyticsSkeleton />;
    case "side-rail":
      return <SideRailSkeleton />;
    case "workbench":
      return <WorkbenchSkeleton />;
    case "workspace-landing":
      return <WorkspaceLandingSkeleton />;
    default:
      return <StandardSkeleton />;
  }
}

export function PageLoadingSkeleton({ profile, label, includeNavigation = true }: PageLoadingSkeletonProps) {
  return (
    <div className="min-h-screen bg-[color:var(--pf-bg)] text-[color:var(--pf-text)]" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {includeNavigation && !profile.startsWith("auth") ? <NavigationSkeleton /> : null}
      <ProfileSkeleton profile={profile} />
    </div>
  );
}

export function AppBootstrapSkeleton({ label }: { label: string }) {
  return <PageLoadingSkeleton profile="standard" label={label} />;
}

export function LayoutSchemeResolvingSkeleton({
  label,
  profile = "workspace-landing",
}: {
  label: string;
  profile?: PageSkeletonProfile;
}) {
  return <PageLoadingSkeleton profile={profile} label={label} />;
}

interface AppBootstrapErrorProps {
  title: string;
  message: string;
  retryLabel: string;
  retryingLabel?: string;
  retrying?: boolean;
  onRetry: () => void;
}

export function AppBootstrapError({
  title,
  message,
  retryLabel,
  retryingLabel,
  retrying = false,
  onRetry,
}: AppBootstrapErrorProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--pf-bg)] px-5 py-10 text-[color:var(--pf-text)]">
      <section className="w-full max-w-lg rounded-2xl border pf-hairline pf-surface p-6 shadow-[var(--pf-shadow)]" role="alert">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 pf-ink-muted">{message}</p>
        <button
          type="button"
          className="mt-5 inline-flex min-h-10 items-center justify-center rounded-md border pf-hairline-strong pf-surface-soft px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pf-accent)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? retryingLabel ?? retryLabel : retryLabel}
        </button>
      </section>
    </main>
  );
}
