import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useI18n } from "./preferences";

export type NotificationVariant = "info" | "success" | "warning" | "error";
export type NotificationBodyLineTone = "default" | "muted" | "warning" | "danger";

export interface NotificationBodyLine {
  text: string;
  tone?: NotificationBodyLineTone;
}

export interface NotificationInput {
  title: string;
  body?: string;
  bodyLines?: NotificationBodyLine[];
  variant?: NotificationVariant;
  autoClose?: boolean;
  autoCloseMs?: number;
  dedupeKey?: string;
}

export interface AppNotification extends Required<Pick<NotificationInput, "title" | "variant" | "autoClose">> {
  id: string;
  body: string | null;
  bodyLines: NotificationBodyLine[];
  autoCloseMs: number;
  createdAt: number;
  dedupeKey: string | null;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  notify: (input: NotificationInput) => string;
  dismiss: (notificationId: string) => void;
  clear: () => void;
}

export const NOTIFICATION_AUTO_CLOSE_MS_STORAGE_KEY = "inspiration-one.notification-auto-close-ms";
export const DEFAULT_NOTIFICATION_AUTO_CLOSE_MS = 5000;
export const MIN_NOTIFICATION_AUTO_CLOSE_MS = 1000;
export const MAX_NOTIFICATION_AUTO_CLOSE_MS = 60000;
const NOTIFICATION_COLLAPSE_THRESHOLD = 2;
const MAX_NOTIFICATION_COUNT = 12;
const NOTIFICATION_AUTO_CLOSE_MS_TTL = 5 * 60 * 1000; // 5 分钟过期

const NotificationContext = createContext<NotificationContextValue | null>(null);

const variantIcons: Record<NotificationVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const variantClassNames: Record<NotificationVariant, string> = {
  info: "border-slate-200 bg-white text-slate-950 shadow-slate-950/10 dark:border-slate-700 dark:bg-[#101827] dark:text-white dark:shadow-black/30",
  success:
    "border-emerald-200 bg-white text-slate-950 shadow-emerald-950/10 dark:border-emerald-400/30 dark:bg-[#101827] dark:text-white dark:shadow-black/30",
  warning:
    "border-amber-200 bg-white text-slate-950 shadow-amber-950/10 dark:border-amber-300/35 dark:bg-[#101827] dark:text-white dark:shadow-black/30",
  error:
    "border-red-200 bg-white text-slate-950 shadow-red-950/10 dark:border-red-400/35 dark:bg-[#101827] dark:text-white dark:shadow-black/30",
};

const iconClassNames: Record<NotificationVariant, string> = {
  info: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200",
  success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  error: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200",
};

const bodyLineClassNames: Record<NotificationBodyLineTone, string> = {
  default: "text-slate-500 dark:text-slate-400",
  muted: "text-slate-400 dark:text-slate-500",
  warning: "font-semibold text-amber-700 dark:text-amber-200",
  danger: "font-semibold text-red-600 dark:text-red-300",
};

function nextNotificationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeNotificationAutoCloseMs(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_NOTIFICATION_AUTO_CLOSE_MS;
  }
  return Math.min(MAX_NOTIFICATION_AUTO_CLOSE_MS, Math.max(MIN_NOTIFICATION_AUTO_CLOSE_MS, Math.round(parsed)));
}

interface NotificationAutoCloseMsCache {
  value: number;
  fetchedAt: number;
}

export function readNotificationAutoCloseMs(): number {
  if (typeof window === "undefined") {
    return DEFAULT_NOTIFICATION_AUTO_CLOSE_MS;
  }
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_AUTO_CLOSE_MS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_NOTIFICATION_AUTO_CLOSE_MS;
    }
    // 尝试解析为带过期时间的缓存格式
    const cache = JSON.parse(raw) as NotificationAutoCloseMsCache;
    if (typeof cache === "object" && cache !== null && "value" in cache && "fetchedAt" in cache) {
      const now = Date.now();
      const isExpired = now > cache.fetchedAt + NOTIFICATION_AUTO_CLOSE_MS_TTL;
      if (!isExpired) {
        return normalizeNotificationAutoCloseMs(cache.value);
      }
      // 过期了，返回默认值，后续会从后端重新拉取
      return DEFAULT_NOTIFICATION_AUTO_CLOSE_MS;
    }
    // 旧格式（纯数字），迁移到新格式
    const legacyValue = normalizeNotificationAutoCloseMs(raw);
    writeNotificationAutoCloseMs(legacyValue);
    return legacyValue;
  } catch {
    // JSON 解析失败，可能是旧格式纯数字
    const raw = window.localStorage.getItem(NOTIFICATION_AUTO_CLOSE_MS_STORAGE_KEY);
    const legacyValue = normalizeNotificationAutoCloseMs(raw);
    writeNotificationAutoCloseMs(legacyValue);
    return legacyValue;
  }
}

export function writeNotificationAutoCloseMs(value: number): void {
  if (typeof window === "undefined") {
    return;
  }
  const cache: NotificationAutoCloseMsCache = {
    value: normalizeNotificationAutoCloseMs(value),
    fetchedAt: Date.now(),
  };
  window.localStorage.setItem(NOTIFICATION_AUTO_CLOSE_MS_STORAGE_KEY, JSON.stringify(cache));
}

function notificationFromInput(input: NotificationInput, fallbackAutoCloseMs?: number): AppNotification {
  const autoClose = input.autoClose ?? false;
  const body = input.body?.trim() || null;
  const fallbackBodyLines: NotificationBodyLine[] | undefined = body
    ? body.split("\n").map((text) => ({ text }))
    : undefined;
  const bodyLines = (input.bodyLines?.length
    ? input.bodyLines
    : fallbackBodyLines
  )?.flatMap((line) => {
    const text = line.text.trim();
    return text ? [{ text, tone: line.tone ?? "default" }] : [];
  }) ?? [];
  return {
    id: nextNotificationId(),
    title: input.title,
    body,
    bodyLines,
    variant: input.variant ?? "info",
    autoClose,
    autoCloseMs: normalizeNotificationAutoCloseMs(
      input.autoCloseMs ?? fallbackAutoCloseMs ?? readNotificationAutoCloseMs()
    ),
    createdAt: Date.now(),
    dedupeKey: input.dedupeKey?.trim() || null,
  };
}

function NotificationBody({ notification, compact }: { notification: AppNotification; compact: boolean }) {
  if (!notification.bodyLines.length) {
    return null;
  }
  return (
    <div className={compact ? "mt-0.5 space-y-0.5 text-xs leading-5" : "mt-1 space-y-1 text-sm leading-5"}>
      {notification.bodyLines.map((line, index) => (
        <p key={`${notification.id}-${index}`} className={bodyLineClassNames[line.tone ?? "default"]}>
          {line.text}
        </p>
      ))}
    </div>
  );
}

function NotificationCard({
  notification,
  compact = false,
  onDismiss,
}: {
  notification: AppNotification;
  compact?: boolean;
  onDismiss: (notificationId: string) => void;
}) {
  const { t } = useI18n();
  const Icon = variantIcons[notification.variant];

  return (
    <article
      className={[
        "pf-shell-notification-card relative overflow-hidden rounded-xl border shadow-xl transition",
        compact ? "px-3 py-2" : "px-4 py-3",
        variantClassNames[notification.variant],
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            "pf-shell-notification-icon inline-flex shrink-0 items-center justify-center rounded-lg",
            compact ? "h-7 w-7" : "h-8 w-8",
            iconClassNames[notification.variant],
          ].join(" ")}
        >
          <Icon size={compact ? 14 : 16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{notification.title}</h2>
          <NotificationBody notification={notification} compact={compact} />
        </div>
        <button
          type="button"
          aria-label={t("notification.close")}
          className="pf-shell-secondary-action inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-violet-400"
          onClick={() => onDismiss(notification.id)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function NotificationDrawer({
  notifications,
  onDismiss,
  onClear,
}: {
  notifications: AppNotification[];
  onDismiss: (notificationId: string) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      className="pf-shell-notification-drawer relative rounded-2xl border border-slate-200 bg-white/96 p-2 shadow-2xl shadow-slate-950/12 backdrop-blur-xl dark:border-slate-700 dark:bg-[#0f1726]/96 dark:shadow-black/35"
      aria-label={t("notification.drawer")}
    >
      <div className="pf-shell-notification-handle absolute -top-2 left-6 h-4 w-28 rounded-t-xl border border-b-0 border-slate-200 bg-white dark:border-slate-700 dark:bg-[#0f1726]" />
      <div className="pf-shell-notification-header relative flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/80">
        <div className="min-w-0">
          <h2 className="pf-shell-value truncate text-sm font-semibold text-slate-950 dark:text-white">
            {t("notification.drawerTitle", { count: notifications.length })}
          </h2>
          <p className="pf-shell-muted mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t("notification.drawerDescription")}</p>
        </div>
        <button
          type="button"
          className="pf-shell-secondary-action inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-violet-400"
          onClick={onClear}
        >
          {t("notification.clearAll")}
        </button>
      </div>
      <div className="mt-2 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
        {notifications.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            compact
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}

function WorkspaceNotificationPopover({
  notifications,
  onDismiss,
  onClear,
}: {
  notifications: AppNotification[];
  onDismiss: (notificationId: string) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const visibleNotifications = notifications.slice(0, NOTIFICATION_COLLAPSE_THRESHOLD);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <aside className="pf-shell-workspace-notification-popover" aria-label={t("notification.drawer")}>
      <div className="pf-shell-workspace-notification-core">
        <div className="pf-shell-workspace-notification-head">
          <div className="min-w-0">
            <strong>{t("notification.centerTitle")}</strong>
            <span>{t("notification.workspaceLayerDescription")}</span>
          </div>
          <button
            type="button"
            className="pf-shell-workspace-notification-count"
            onClick={onClear}
            disabled={notifications.length === 0}
            aria-label={t("notification.clearAll")}
          >
            {notifications.length}
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {visibleNotifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              compact
              onDismiss={onDismiss}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [defaultAutoCloseMs, setDefaultAutoCloseMs] = useState(readNotificationAutoCloseMs);

  // 监听 localStorage 变化（跨标签页同步）
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === NOTIFICATION_AUTO_CLOSE_MS_STORAGE_KEY) {
        setDefaultAutoCloseMs(readNotificationAutoCloseMs());
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // 定期检查缓存是否过期
  useEffect(() => {
    const checkExpiration = () => {
      try {
        const raw = window.localStorage.getItem(NOTIFICATION_AUTO_CLOSE_MS_STORAGE_KEY);
        if (!raw) return;
        const cache = JSON.parse(raw) as NotificationAutoCloseMsCache;
        if (typeof cache === "object" && cache !== null && "fetchedAt" in cache) {
          const now = Date.now();
          const isExpired = now > cache.fetchedAt + NOTIFICATION_AUTO_CLOSE_MS_TTL;
          if (isExpired) {
            // 过期了，更新状态触发重新读取
            setDefaultAutoCloseMs(DEFAULT_NOTIFICATION_AUTO_CLOSE_MS);
          }
        }
      } catch {
        // 忽略解析错误
      }
    };

    // 启动时检查一次
    checkExpiration();

    // 每分钟检查一次
    const timer = window.setInterval(checkExpiration, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const dismiss = useCallback((notificationId: string) => {
    setNotifications((current) => current.filter((notification) => notification.id !== notificationId));
  }, []);

  const clear = useCallback(() => {
    setNotifications([]);
  }, []);

  const notify = useCallback((input: NotificationInput) => {
    const nextNotification = notificationFromInput(input, defaultAutoCloseMs);
    setNotifications((current) => {
      if (nextNotification.dedupeKey) {
        const existingIndex = current.findIndex((item) => item.dedupeKey === nextNotification.dedupeKey);
        if (existingIndex >= 0) {
          const next = [...current];
          next[existingIndex] = {
            ...nextNotification,
            id: current[existingIndex].id,
          };
          return next;
        }
      }
      return [nextNotification, ...current].slice(0, MAX_NOTIFICATION_COUNT);
    });
    return nextNotification.id;
  }, [defaultAutoCloseMs]);

  useEffect(() => {
    const timers = notifications
      .filter((notification) => notification.autoClose)
      .map((notification) => {
        const remainingMs = Math.max(0, notification.createdAt + notification.autoCloseMs - Date.now());
        return window.setTimeout(() => dismiss(notification.id), remainingMs);
      });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dismiss, notifications]);

  const value = useMemo(
    () => ({
      notifications,
      notify,
      dismiss,
      clear,
    }),
    [clear, dismiss, notifications, notify],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pf-shell-notification-classic-region fixed right-3 top-20 z-[70] w-[min(360px,calc(100vw-1.5rem))] sm:right-5" aria-live="polite" aria-relevant="additions text">
        {notifications.length > NOTIFICATION_COLLAPSE_THRESHOLD ? (
          <NotificationDrawer notifications={notifications} onDismiss={dismiss} onClear={clear} />
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => (
              <NotificationCard key={notification.id} notification={notification} onDismiss={dismiss} />
            ))}
          </div>
        )}
      </div>
      <WorkspaceNotificationPopover notifications={notifications} onDismiss={dismiss} onClear={clear} />
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    return {
      notifications: [],
      notify: () => "",
      dismiss: () => undefined,
      clear: () => undefined,
    };
  }
  return context;
}
