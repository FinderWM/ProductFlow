import { Archive, History, Loader2, MessagesSquare } from "lucide-react";

import {
  getResourceBlockedActionTitle,
  isResourceBlocked,
  isResourceDeleted,
  ResourceMetaBadges,
} from "../../components/ResourceGovernance";
import { SensitiveImageOverlay, sensitiveImageClassName } from "../../components/SensitiveImageMask";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { shouldMaskSensitiveImage } from "../../lib/sensitiveImages";
import type { ImageSessionSummary, SessionUser } from "../../lib/types";
import type { ImageChatTranslate } from "./display";

interface ImageChatSessionListProps {
  items: ImageSessionSummary[];
  isLoading: boolean;
  selectedSessionId: string | null;
  deletingSessionId: string | null;
  deletionEnabled: boolean;
  deletionBlockedTitle?: string | null;
  currentUser?: SessionUser | null;
  variant: "desktop" | "mobile";
  maskSensitiveImages: boolean;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  t: ImageChatTranslate;
}

export function ImageChatSessionList({
  items,
  isLoading,
  selectedSessionId,
  deletingSessionId,
  deletionEnabled,
  deletionBlockedTitle = null,
  currentUser = null,
  variant,
  maskSensitiveImages,
  onSelectSession,
  onDeleteSession,
  t,
}: ImageChatSessionListProps) {
  const containerClassName =
    variant === "desktop"
      ? "pf-image-chat-session-list flex gap-3 overflow-x-auto p-3 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-2 lg:overflow-x-visible lg:overflow-y-auto lg:px-8"
      : "pf-image-chat-session-list min-h-0 flex-1 space-y-2 overflow-y-auto p-3";

  return (
    <div className={containerClassName}>
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto lg:flex-col lg:gap-2 lg:overflow-x-visible">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`pf-image-chat-session-card flex shrink-0 items-center gap-3 rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm dark:border-slate-800/80 dark:bg-[#151f33] ${
                variant === "desktop" ? "w-64 lg:w-auto" : "w-full"
              }`}
            >
              <div className="pf-image-chat-session-thumb h-16 w-16 shrink-0 rounded-xl bg-slate-200 dark:bg-[#0a1020] animate-shimmer" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded bg-slate-100 dark:bg-slate-800/60 animate-shimmer" />
                <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800/60 animate-shimmer" />
                <div className="h-3 w-1/3 rounded bg-slate-100 dark:bg-slate-800/60 animate-shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length ? (
        items.map((item) => (
          <ImageChatSessionCard
            key={item.id}
            item={item}
            active={item.id === selectedSessionId}
            deleting={deletingSessionId === item.id}
            deletionEnabled={deletionEnabled}
            deletionBlockedTitle={deletionBlockedTitle}
            currentUser={currentUser}
            variant={variant}
            maskSensitiveImages={maskSensitiveImages}
            onSelectSession={onSelectSession}
            onDeleteSession={onDeleteSession}
            t={t}
          />
        ))
      ) : (
        <div className="pf-image-chat-session-empty pf-workspace-card-soft pf-workspace-muted rounded-2xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t("chat.noSessions")}
        </div>
      )}
    </div>
  );
}

interface ImageChatSessionCardProps {
  item: ImageSessionSummary;
  active: boolean;
  deleting: boolean;
  deletionEnabled: boolean;
  deletionBlockedTitle: string | null;
  currentUser: SessionUser | null;
  variant: "desktop" | "mobile";
  maskSensitiveImages: boolean;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  t: ImageChatTranslate;
}

function ImageChatSessionCard({
  item,
  active,
  deleting,
  deletionEnabled,
  deletionBlockedTitle,
  currentUser,
  variant,
  maskSensitiveImages,
  onSelectSession,
  onDeleteSession,
  t,
}: ImageChatSessionCardProps) {
  const cardStateClassName = active ? "pf-image-chat-session-card--active" : "pf-image-chat-session-card--idle";
  const cardClassName = `pf-image-chat-session-card ${cardStateClassName} group relative overflow-hidden rounded-2xl border transition-all ${
    variant === "desktop" ? "w-64 shrink-0 lg:w-auto " : ""
  }${
    active
      ? "border-indigo-300 bg-indigo-50 shadow-sm shadow-indigo-100 ring-1 ring-indigo-200/80 dark:border-violet-500/80 dark:bg-violet-500/14 dark:shadow-violet-950/30 dark:ring-violet-400/45"
      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/75 dark:bg-[#151f33] dark:hover:border-violet-500/45 dark:hover:bg-[#1a2740]"
  }`;
  const selectClassName =
    variant === "desktop"
      ? "pf-image-chat-session-card-button flex w-full items-center gap-3 p-2.5 pr-10 text-left"
      : "pf-image-chat-session-card-button flex min-h-20 w-full items-center gap-3 p-2.5 pr-12 text-left active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400";
  const deleteClassName =
    variant === "desktop"
      ? "pf-image-chat-session-delete absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/95 text-slate-400 opacity-100 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-red-600 disabled:opacity-60 dark:bg-slate-950/88 dark:text-slate-400 dark:ring-slate-700 dark:hover:text-red-300 md:opacity-0 md:group-hover:opacity-100"
      : "pf-image-chat-session-delete absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 text-slate-400 shadow-sm ring-1 ring-slate-200 transition-colors active:scale-[0.98] hover:text-red-600 disabled:opacity-60 dark:bg-slate-950/88 dark:text-slate-400 dark:ring-slate-700 dark:hover:text-red-300";
  const blocked = isResourceBlocked(item);
  const deleted = isResourceDeleted(item);
  const blockedTitle = getResourceBlockedActionTitle(item, t("resource.blockedAction"));
  const adminReadonly = Boolean(currentUser?.is_admin && item.owner_user_id && currentUser.id !== item.owner_user_id);
  const deleteDisabled = deleting || !deletionEnabled || Boolean(deletionBlockedTitle) || blocked || deleted || adminReadonly;
  const latestImageMasked = shouldMaskSensitiveImage(maskSensitiveImages, item.latest_resource_group);

  return (
    <div className={cardClassName}>
      <button type="button" onClick={() => onSelectSession(item.id)} className={selectClassName}>
        <div className="pf-image-chat-session-thumb relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400 ring-1 ring-slate-200 dark:bg-[#0a1020] dark:text-slate-400 dark:ring-slate-600/80">
          {item.latest_generated_asset ? (
            <img
              src={api.toApiUrl(item.latest_generated_asset.thumbnail_url)}
              alt={item.title}
              loading="lazy"
              decoding="async"
              className={sensitiveImageClassName(latestImageMasked, "h-full w-full object-cover")}
            />
          ) : (
            <MessagesSquare size={18} />
          )}
          {item.latest_generated_asset ? (
            <SensitiveImageOverlay masked={latestImageMasked} label={t("common.sensitiveImageMasked")} />
          ) : null}
          {active ? <div className="absolute inset-0 ring-2 ring-inset ring-indigo-500/60 dark:ring-violet-400/80" /> : null}
        </div>
        <div className="pf-workspace-latest-copy min-w-0 flex-1">
          <div
            className={`pf-image-chat-session-title truncate text-sm font-semibold ${active ? "text-indigo-950 dark:text-white" : "text-slate-900 dark:text-slate-100"}`}
            title={item.title}
          >
            {item.title}
          </div>
          <div className="pf-image-chat-session-meta pf-workspace-muted mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-300">
            <History size={11} />
            <span>{t("chat.roundCount", { count: item.rounds_count })}</span>
          </div>
          {item.latest_resource_group ? (
            <div className="pf-image-chat-session-tag pf-workspace-chip mt-1 inline-flex max-w-full rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:border-violet-400/30 dark:bg-violet-500/12 dark:text-violet-100">
              <span className="truncate">{item.latest_resource_group.name}</span>
            </div>
          ) : null}
          <div className="pf-image-chat-session-time pf-workspace-subtle mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">
            {formatDateTime(item.updated_at)}
          </div>
          <ResourceMetaBadges resource={item} className="mt-1" />
        </div>
      </button>
      <button
        type="button"
        aria-label={t("chat.deleteSession")}
        onClick={() => onDeleteSession(item.id)}
        disabled={deleteDisabled}
        title={
          deleted
            ? t("resource.deleted")
            : blocked
              ? blockedTitle
              : deletionBlockedTitle
                ? deletionBlockedTitle
                : adminReadonly
                  ? t("resource.adminReadonlyAction")
                  : deletionEnabled
                    ? t("chat.deleteSession")
                    : t("chat.deleteDisabled")
        }
        className={deleteClassName}
      >
        {deleting ? <Loader2 size={variant === "desktop" ? 13 : 14} className="animate-spin" /> : <Archive size={variant === "desktop" ? 13 : 15} />}
      </button>
    </div>
  );
}
