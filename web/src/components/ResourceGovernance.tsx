import { Ban, UserRound } from "lucide-react";

import { useI18n } from "../lib/preferences";
import type { ModerationFields } from "../lib/types";

export interface GovernedResource extends ModerationFields {
  owner_username?: string | null;
  owner_user_id?: string | null;
}

export function isResourceBlocked(resource: ModerationFields | null | undefined): boolean {
  const effectiveEnabled = resource?.effective_enabled ?? resource?.enabled;
  return effectiveEnabled === false;
}

export function getResourceDisabledReason(resource: ModerationFields | null | undefined): string | null {
  return resource?.effective_disabled_reason ?? resource?.disabled_reason ?? null;
}

export function getResourceBlockedActionTitle(
  resource: ModerationFields | null | undefined,
  fallback: string,
): string {
  const reason = getResourceDisabledReason(resource);
  return reason ? `${fallback} ${reason}` : fallback;
}

export function ResourceMetaBadges({
  resource,
  className = "",
  showReason = false,
}: {
  resource: GovernedResource | null | undefined;
  className?: string;
  showReason?: boolean;
}) {
  const { t } = useI18n();
  const blocked = isResourceBlocked(resource);
  const reason = getResourceDisabledReason(resource);
  const ownerUsername = resource?.owner_username ?? null;

  if (!blocked && !ownerUsername) {
    return null;
  }

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}>
      {ownerUsername ? (
        <span className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300">
          <UserRound size={11} className="mr-1 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("resource.owner", { username: ownerUsername })}</span>
        </span>
      ) : null}
      {blocked ? (
        <span
          className="inline-flex max-w-full items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:border-red-400/35 dark:bg-red-500/12 dark:text-red-200"
          title={reason ? t("resource.disabledReason", { reason }) : t("resource.disabled")}
        >
          <Ban size={11} className="mr-1 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("resource.disabled")}</span>
        </span>
      ) : null}
      {blocked && showReason && reason ? (
        <span className="min-w-0 max-w-full truncate text-[11px] font-medium text-red-600 dark:text-red-200">
          {t("resource.disabledReason", { reason })}
        </span>
      ) : null}
    </div>
  );
}

export function ResourceBlockedNotice({
  resource,
  className = "",
}: {
  resource: ModerationFields | null | undefined;
  className?: string;
}) {
  const { t } = useI18n();
  if (!isResourceBlocked(resource)) {
    return null;
  }
  const reason = getResourceDisabledReason(resource);

  return (
    <div
      className={`rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200 ${className}`}
    >
      <Ban size={13} className="mr-1.5 inline align-[-2px]" aria-hidden="true" />
      {t("resource.disabledNotice")}
      {reason ? <span className="ml-1 font-semibold">{t("resource.disabledReason", { reason })}</span> : null}
    </div>
  );
}
