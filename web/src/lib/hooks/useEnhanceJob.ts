import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import type { EnhanceJob, JobStatus } from "../types";

export const ENHANCE_JOB_POLL_INTERVAL_MS = 1_500;
const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set(["succeeded", "failed", "cancelled"]);

export function isEnhanceJobTerminal(job: Pick<EnhanceJob, "status"> | null | undefined): boolean {
  return Boolean(job && TERMINAL_STATUSES.has(job.status));
}

export function useEnhanceJob(jobId: string | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["enhance-job", jobId],
    queryFn: () => api.getEnhanceJob(jobId ?? ""),
    enabled: Boolean(jobId) && (options?.enabled ?? true),
    refetchInterval: (query) => (isEnhanceJobTerminal(query.state.data) ? false : ENHANCE_JOB_POLL_INTERVAL_MS),
  });
}
