import type { HTMLAttributes } from "react";

function mergeClassNames(...classNames: Array<string | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  rounded?: "sm" | "md" | "lg" | "full";
}

const ROUNDED_CLASS = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
} as const;

export function Skeleton({ className, rounded = "md", ...props }: SkeletonProps) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={mergeClassNames("pf-skeleton", ROUNDED_CLASS[rounded], className)}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={mergeClassNames("space-y-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={mergeClassNames("h-3", index === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={mergeClassNames("divide-y pf-hairline", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="grid min-h-16 grid-cols-[3rem_minmax(0,1fr)_6rem] items-center gap-3 py-3">
          <Skeleton className="h-10 w-10" rounded="lg" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-4/5 opacity-70" />
          </div>
          <Skeleton className="h-7 w-full" rounded="full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={mergeClassNames("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {Array.from({ length: count }, (_, index) => (
        <article key={index} className="overflow-hidden rounded-xl border pf-hairline pf-surface">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-3/5" />
            <SkeletonText lines={2} />
          </div>
        </article>
      ))}
    </div>
  );
}

export function SkeletonMetrics({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={mergeClassNames("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-xl border pf-hairline pf-surface p-4">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-4 h-8 w-2/5" />
          <Skeleton className="mt-3 h-3 w-3/4 opacity-70" />
        </div>
      ))}
    </div>
  );
}
