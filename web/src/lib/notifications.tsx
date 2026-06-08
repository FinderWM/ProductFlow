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

export function readNotificationAutoCloseMs(): number {
  if (typeof window === "undefined") {
    return DEFAULT_NOTIFICATION_AUTO_CLOSE_MS;
  }
  return normalizeNotificationAutoCloseMs(window.localStorage.getItem(NOTIFICATION_AUTO_CLOSE_MS_STORAGE_KEY));
}

export function writeNotificationAutoCloseMs(value: number): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(NOTIFICATION_AUTO_CLOSE_MS_STORAGE_KEY, String(normalizeNotificationAutoCloseMs(value)));
}

function notificationFromInput(input: NotificationInput): AppNotification {
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
    autoCloseMs: normalizeNotificationAutoCloseMs(input.autoCloseMs ?? readNotificationAutoCloseMs()),
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
        "relative overflow-hidden rounded-xl border shadow-xl transition",
        compact ? "px-3 py-2" : "px-4 py-3",
        variantClassNames[notification.variant],
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            "inline-flex shrink-0 items-center justify-center rounded-lg",
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
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-violet-400"
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
      className="relative rounded-2xl border border-slate-200 bg-white/96 p-2 shadow-2xl shadow-slate-950/12 backdrop-blur-xl dark:border-slate-700 dark:bg-[#0f1726]/96 dark:shadow-black/35"
      aria-label={t("notification.drawer")}
    >
      <div className="absolute -top-2 left-6 h-4 w-28 rounded-t-xl border border-b-0 border-slate-200 bg-white dark:border-slate-700 dark:bg-[#0f1726]" />
      <div className="relative flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/80">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-950 dark:text-white">
            {t("notification.drawerTitle", { count: notifications.length })}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t("notification.drawerDescription")}</p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-violet-400"
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

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const dismiss = useCallback((notificationId: string) => {
    setNotifications((current) => current.filter((notification) => notification.id !== notificationId));
  }, []);

  const clear = useCallback(() => {
    setNotifications([]);
  }, []);

  const notify = useCallback((input: NotificationInput) => {
    const nextNotification = notificationFromInput(input);
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
  }, []);

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
      <div className="fixed right-3 top-20 z-[70] w-[min(360px,calc(100vw-1.5rem))] sm:right-5" aria-live="polite" aria-relevant="additions text">
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
