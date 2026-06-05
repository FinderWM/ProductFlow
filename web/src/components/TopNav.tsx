import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  GalleryHorizontalEnd,
  Languages,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  MessagesSquare,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
  Wand2,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { LOCALES, type Locale, type TranslationKey } from "../lib/i18n";
import { usePreferences } from "../lib/preferences";
import {
  API_GALLERY_READ,
  API_IMAGE_CHAT_READ,
  API_INSPIRATIONS_READ,
  API_SETTINGS_READ,
  API_STATUS_READ,
  API_USAGE_STATS_READ,
  hasRbacManagementAccess,
  hasSessionMenuApiPermission,
} from "../lib/rbac";
import { useSessionState } from "../lib/session";
import { THEME_PREFERENCES, type ThemePreference } from "../lib/theme";
import type { SessionState, SessionUser } from "../lib/types";

interface TopNavProps {
  breadcrumbs?: string;
  onHome?: () => void;
  onLogout?: () => void;
}

type NavPriority = "primary" | "secondary";

interface TopNavItem {
  labelKey: TranslationKey;
  to: string;
  menuCode: string | null;
  requiredPermission?: string;
  hasAccess?: (session: SessionState | null) => boolean;
  priority: NavPriority;
  icon: typeof Activity;
  match: (pathname: string) => boolean;
}

interface AccountIdentity {
  displayName: string;
  username: string;
}

export interface DesktopNavLayoutInput {
  key: string;
  priority: NavPriority;
  active: boolean;
  width: number;
}

export interface DesktopNavLayout {
  visibleKeys: string[];
  overflowKeys: string[];
}

const DESKTOP_NAV_GAP_PX = 4;
const DESKTOP_NAV_HORIZONTAL_CHROME_PX = 10;

const navItems: TopNavItem[] = [
  {
    labelKey: "nav.products",
    to: "/products",
    menuCode: "inspirations",
    requiredPermission: API_INSPIRATIONS_READ,
    priority: "primary",
    icon: LayoutGrid,
    match: (pathname: string) => pathname.startsWith("/products") && !pathname.endsWith("/image-chat"),
  },
  {
    labelKey: "nav.imageChat",
    to: "/image-chat",
    menuCode: "image_chat",
    requiredPermission: API_IMAGE_CHAT_READ,
    priority: "primary",
    icon: MessagesSquare,
    match: (pathname: string) => pathname.includes("image-chat"),
  },
  {
    labelKey: "nav.gallery",
    to: "/gallery",
    menuCode: "gallery",
    requiredPermission: API_GALLERY_READ,
    priority: "primary",
    icon: GalleryHorizontalEnd,
    match: (pathname: string) => pathname.startsWith("/gallery"),
  },
  {
    labelKey: "nav.status",
    to: "/status",
    menuCode: "status",
    requiredPermission: API_STATUS_READ,
    priority: "primary",
    icon: Activity,
    match: (pathname: string) => pathname.startsWith("/status"),
  },
  {
    labelKey: "nav.usageStats",
    to: "/usage-stats",
    menuCode: "usage_stats",
    requiredPermission: API_USAGE_STATS_READ,
    priority: "secondary",
    icon: BarChart3,
    match: (pathname: string) => pathname.startsWith("/usage-stats"),
  },
  {
    labelKey: "nav.settings",
    to: "/settings",
    menuCode: "settings",
    requiredPermission: API_SETTINGS_READ,
    priority: "primary",
    icon: Settings,
    match: (pathname: string) => pathname.startsWith("/settings"),
  },
  {
    labelKey: "nav.rbac",
    to: "/rbac",
    menuCode: "rbac",
    hasAccess: hasRbacManagementAccess,
    priority: "secondary",
    icon: ShieldCheck,
    match: (pathname: string) => pathname.startsWith("/rbac"),
  },
  {
    labelKey: "nav.help",
    to: "/help",
    menuCode: null,
    priority: "secondary",
    icon: BookOpen,
    match: (pathname: string) => pathname.startsWith("/help"),
  },
];

function safeWidth(width: number) {
  return Number.isFinite(width) ? Math.max(0, width) : 0;
}

function widthForControls(controlWidths: number[], gap: number) {
  if (controlWidths.length === 0) {
    return 0;
  }
  return controlWidths.reduce((total, width) => total + safeWidth(width), 0) + (controlWidths.length - 1) * gap;
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function getDesktopNavLayout({
  items,
  availableWidth,
  moreButtonWidth,
  gap = DESKTOP_NAV_GAP_PX,
}: {
  items: DesktopNavLayoutInput[];
  availableWidth: number;
  moreButtonWidth: number;
  gap?: number;
}): DesktopNavLayout {
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const overflowKeys = new Set<string>();
  let visibleKeys = items.map((item) => item.key);
  const usableWidth = safeWidth(availableWidth);

  if (items.length === 0 || usableWidth <= 0) {
    return { visibleKeys, overflowKeys: [] };
  }

  const getVisibleWidth = () => {
    const visibleWidths = visibleKeys.map((key) => itemByKey.get(key)?.width ?? 0);
    const controlWidths = overflowKeys.size > 0 ? [...visibleWidths, moreButtonWidth] : visibleWidths;
    return widthForControls(controlWidths, Math.max(0, gap));
  };

  const pickOverflowKey = () => {
    const reversedVisibleKeys = [...visibleKeys].reverse();
    const buckets: Array<{ priority: NavPriority; active: boolean }> = [
      { priority: "secondary", active: false },
      { priority: "secondary", active: true },
      { priority: "primary", active: false },
      { priority: "primary", active: true },
    ];

    for (const bucket of buckets) {
      const match = reversedVisibleKeys.find((key) => {
        const item = itemByKey.get(key);
        return item?.priority === bucket.priority && item.active === bucket.active;
      });
      if (match) {
        return match;
      }
    }

    return reversedVisibleKeys[0];
  };

  while (visibleKeys.length > 0 && getVisibleWidth() > usableWidth) {
    const nextOverflowKey = pickOverflowKey();
    if (!nextOverflowKey) {
      break;
    }
    overflowKeys.add(nextOverflowKey);
    visibleKeys = visibleKeys.filter((key) => key !== nextOverflowKey);
  }

  return {
    visibleKeys,
    overflowKeys: items.map((item) => item.key).filter((key) => overflowKeys.has(key)),
  };
}

const themeIcons: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const localeLabelKey: Record<Locale, TranslationKey> = {
  "zh-CN": "locale.zhCN",
  "en-US": "locale.enUS",
  "ja-JP": "locale.jaJP",
};

const localeMarkers: Record<Locale, string> = {
  "zh-CN": "zh",
  "en-US": "en",
  "ja-JP": "ja",
};

function navItemClassName(active: boolean) {
  return [
    "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors",
    active
      ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700"
      : "text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100",
  ].join(" ");
}

function menuItemClassName(active: boolean) {
  return [
    "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition-colors",
    active
      ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
  ].join(" ");
}

function mobileNavItemClassName(active: boolean) {
  return [
    "flex min-h-14 min-w-0 flex-col items-center justify-center rounded-xl px-0.5 text-[10px] font-semibold transition-colors active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400",
    active
      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100",
  ].join(" ");
}

function preferenceTriggerClassName(hasMarker: boolean) {
  return [
    "inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white/80 text-sm font-semibold text-slate-600 shadow-sm shadow-slate-950/[0.03] transition-colors active:scale-[0.98] hover:border-slate-300 hover:bg-white hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:shadow-black/20 dark:hover:border-slate-500 dark:hover:bg-slate-900 dark:hover:text-slate-100",
    hasMarker ? "min-w-16 gap-1.5 px-2" : "w-9 px-0",
  ].join(" ");
}

function preferenceMenuClassName(open: boolean) {
  return [
    "absolute right-0 top-11 z-50 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-950/10 transition dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/30",
    open ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0",
  ].join(" ");
}

function accountMenuClassName(open: boolean) {
  return [
    "absolute right-0 top-11 z-50 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-950/10 transition dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/30",
    open ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0",
  ].join(" ");
}

function desktopMoreMenuClassName(open: boolean) {
  return [
    "absolute right-0 top-10 z-50 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-950/10 transition dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/30",
    open ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0",
  ].join(" ");
}

function preferenceMenuItemClassName(active: boolean) {
  return [
    "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-semibold transition-colors",
    active
      ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
  ].join(" ");
}

function preferenceBadgeClassName(active: boolean) {
  return [
    "inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border px-1.5 text-[11px] font-bold leading-none",
    active
      ? "border-slate-300 bg-white text-slate-950 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
      : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  ].join(" ");
}

function accountIdentity(user: SessionUser | null | undefined, fallbackName: string): AccountIdentity {
  const username = user?.username ?? "";
  const displayName = user?.display_name?.trim() || username || fallbackName;
  return { displayName, username };
}

type PreferenceOption<T extends string> = {
  value: T;
  label: string;
  icon?: typeof Sun;
  marker?: string;
};

function PreferenceMenu<T extends string>({
  label,
  currentLabel,
  options,
  value,
  onChange,
  triggerIcon: TriggerIcon,
  triggerMarker,
}: {
  label: string;
  currentLabel: string;
  options: Array<PreferenceOption<T>>;
  value: T;
  onChange: (value: T) => void;
  triggerIcon?: typeof Sun;
  triggerMarker?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={`${label}: ${currentLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${label}: ${currentLabel}`}
        className={preferenceTriggerClassName(Boolean(triggerMarker))}
        onClick={() => setOpen((current) => !current)}
      >
        {TriggerIcon ? <TriggerIcon size={15} aria-hidden="true" /> : null}
        {triggerMarker ? <span className={preferenceBadgeClassName(true)}>{triggerMarker}</span> : null}
      </button>
      <div role="menu" aria-label={label} className={preferenceMenuClassName(open)}>
        <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
          {label}
        </div>
        {options.map((option) => {
          const active = option.value === value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className={preferenceMenuItemClassName(active)}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {Icon ? (
                <span className={preferenceBadgeClassName(active)}>
                  <Icon size={14} aria-hidden="true" />
                </span>
              ) : (
                <span className={preferenceBadgeClassName(active)}>{option.marker}</span>
              )}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <Check
                size={14}
                aria-hidden="true"
                className={active ? "text-indigo-600 dark:text-violet-300" : "text-transparent"}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AccountMenu({ identity, onLogout }: { identity: AccountIdentity; onLogout: () => void }) {
  const { t } = usePreferences();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const accountLabel = identity.username
    ? `${identity.displayName} · ${identity.username}`
    : identity.displayName;

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div
      ref={menuRef}
      className="relative"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={`${t("nav.accountMenu")}: ${accountLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={accountLabel}
        className="inline-flex h-10 max-w-[220px] items-center gap-2 rounded-lg border border-slate-200 bg-white/85 px-2 text-left text-sm shadow-sm shadow-slate-950/[0.03] transition-colors hover:border-slate-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/70 dark:shadow-black/20 dark:hover:border-slate-500 dark:hover:bg-slate-900 dark:focus-visible:ring-violet-400 xl:max-w-[260px]"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
          <UserRound size={15} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
            {identity.displayName}
          </span>
          {identity.username ? (
            <span className="block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {identity.username}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <div role="menu" aria-label={t("nav.accountMenu")} className={accountMenuClassName(open)}>
        <div role="presentation" className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
          <div className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
            {t("nav.currentAccount")}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-950 dark:text-white">
            {identity.displayName}
          </div>
          {identity.username ? (
            <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{identity.username}</div>
          ) : null}
        </div>
        <button
          type="button"
          role="menuitem"
          className="mt-1 flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold text-slate-600 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-slate-300 dark:hover:bg-red-500/10 dark:hover:text-red-200"
          onClick={() => {
            setOpen(false);
            onLogout();
          }}
        >
          <LogOut size={15} aria-hidden="true" />
          <span className="truncate">{t("nav.logout")}</span>
        </button>
      </div>
    </div>
  );
}

export function TopNav({ breadcrumbs, onHome, onLogout }: TopNavProps) {
  const desktopNavAreaRef = useRef<HTMLDivElement | null>(null);
  const desktopMeasureRowRef = useRef<HTMLDivElement | null>(null);
  const desktopMeasureItemRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const desktopMoreMeasureRef = useRef<HTMLSpanElement | null>(null);
  const desktopMoreMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopMoreCloseTimerRef = useRef<number | null>(null);
  const [desktopOverflowKeys, setDesktopOverflowKeys] = useState<string[]>([]);
  const [desktopMoreOpen, setDesktopMoreOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const location = useLocation();
  const { locale, setLocale, t, themePreference, setThemePreference } = usePreferences();
  const session = useSessionState();
  const visibleNavItems = useMemo(
    () =>
      navItems.filter((item) => {
        if (item.hasAccess) {
          return item.hasAccess(session);
        }
        return (
          item.menuCode === null ||
          (item.requiredPermission
            ? hasSessionMenuApiPermission(session, item.menuCode, item.requiredPermission)
            : false)
        );
      }),
    [session],
  );
  const CurrentThemeIcon = themeIcons[themePreference];
  const themeOptions = THEME_PREFERENCES.map((theme) => ({
    value: theme,
    label: t(`theme.${theme}`),
    icon: themeIcons[theme],
  }));
  const localeOptions = LOCALES.map((availableLocale) => ({
    value: availableLocale,
    label: t(localeLabelKey[availableLocale]),
    marker: localeMarkers[availableLocale],
  }));
  const primaryNavItems = visibleNavItems.filter((item) => item.priority === "primary");
  const secondaryNavItems = visibleNavItems.filter((item) => item.priority === "secondary");
  const secondaryActive = secondaryNavItems.some((item) => item.match(location.pathname));
  const hasOverflowNav = secondaryNavItems.length > 0 || Boolean(onLogout);
  const mobileNavColumnCount = primaryNavItems.length + (hasOverflowNav ? 1 : 0);
  const desktopOverflowKeySet = useMemo(() => new Set(desktopOverflowKeys), [desktopOverflowKeys]);
  const desktopVisibleNavItems = visibleNavItems.filter((item) => !desktopOverflowKeySet.has(item.to));
  const desktopOverflowNavItems = visibleNavItems.filter((item) => desktopOverflowKeySet.has(item.to));
  const desktopOverflowActive = desktopOverflowNavItems.some((item) => item.match(location.pathname));
  const account = accountIdentity(session?.user, t("nav.account"));

  const clearDesktopMoreCloseTimer = useCallback(() => {
    if (desktopMoreCloseTimerRef.current !== null) {
      window.clearTimeout(desktopMoreCloseTimerRef.current);
      desktopMoreCloseTimerRef.current = null;
    }
  }, []);

  const scheduleDesktopMoreClose = useCallback(() => {
    clearDesktopMoreCloseTimer();
    desktopMoreCloseTimerRef.current = window.setTimeout(() => {
      setDesktopMoreOpen(false);
      desktopMoreCloseTimerRef.current = null;
    }, 180);
  }, [clearDesktopMoreCloseTimer]);

  const updateDesktopNavLayout = useCallback(() => {
    const navArea = desktopNavAreaRef.current;
    const moreMeasure = desktopMoreMeasureRef.current;
    if (!navArea || !moreMeasure) {
      return;
    }

    const layoutItems = visibleNavItems.map((item) => ({
      key: item.to,
      priority: item.priority,
      active: item.match(location.pathname),
      width: desktopMeasureItemRefs.current[item.to]?.getBoundingClientRect().width ?? 0,
    }));
    const moreButtonWidth = moreMeasure.getBoundingClientRect().width;

    if (layoutItems.some((item) => item.width <= 0) || moreButtonWidth <= 0) {
      setDesktopOverflowKeys((current) => (current.length === 0 ? current : []));
      return;
    }

    const layout = getDesktopNavLayout({
      items: layoutItems,
      availableWidth: navArea.clientWidth - DESKTOP_NAV_HORIZONTAL_CHROME_PX,
      moreButtonWidth,
    });
    setDesktopOverflowKeys((current) => (arraysEqual(current, layout.overflowKeys) ? current : layout.overflowKeys));
  }, [location.pathname, visibleNavItems]);

  useLayoutEffect(() => {
    updateDesktopNavLayout();
  }, [locale, updateDesktopNavLayout]);

  useEffect(() => () => clearDesktopMoreCloseTimer(), [clearDesktopMoreCloseTimer]);

  useEffect(() => {
    const navArea = desktopNavAreaRef.current;
    if (!navArea || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateDesktopNavLayout);
    observer.observe(navArea);
    if (desktopMeasureRowRef.current) {
      observer.observe(desktopMeasureRowRef.current);
    }
    updateDesktopNavLayout();
    return () => observer.disconnect();
  }, [updateDesktopNavLayout]);

  useEffect(() => {
    if (desktopOverflowNavItems.length === 0) {
      setDesktopMoreOpen(false);
    }
  }, [desktopOverflowNavItems.length]);

  useEffect(() => {
    if (!desktopMoreOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && desktopMoreMenuRef.current?.contains(target)) {
        return;
      }
      clearDesktopMoreCloseTimer();
      setDesktopMoreOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [clearDesktopMoreCloseTimer, desktopMoreOpen]);

  const renderPreferenceControls = () => (
    <>
      <PreferenceMenu
        label={t("nav.language")}
        currentLabel={t(localeLabelKey[locale])}
        options={localeOptions}
        value={locale}
        onChange={setLocale}
        triggerIcon={Languages}
        triggerMarker={localeMarkers[locale]}
      />
      <PreferenceMenu
        label={t("nav.theme")}
        currentLabel={t(`theme.${themePreference}`)}
        options={themeOptions}
        value={themePreference}
        onChange={setThemePreference}
        triggerIcon={CurrentThemeIcon}
      />
    </>
  );

  const renderDesktopNavItem = (item: TopNavItem) => {
    const Icon = item.icon;
    const active = item.match(location.pathname);
    const label = t(item.labelKey);
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        className={navItemClassName(active)}
        title={label}
      >
        <Icon size={16} />
        <span className="inline">{label}</span>
      </Link>
    );
  };

  const renderDesktopNavMeasurementItem = (item: TopNavItem) => {
    const Icon = item.icon;
    const label = t(item.labelKey);
    return (
      <span
        key={item.to}
        ref={(node) => {
          desktopMeasureItemRefs.current[item.to] = node;
        }}
        className={navItemClassName(false)}
      >
        <Icon size={16} aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  };

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/94 px-3 py-3 shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-xl dark:border-slate-800 dark:bg-[#070b13]/94 sm:px-4 lg:px-5">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm md:min-w-40 md:shrink-0 lg:min-w-44 2xl:w-64">
            {onHome ? (
              <button
                type="button"
                className="flex min-w-0 items-center text-base font-semibold text-slate-950 transition-colors hover:text-indigo-700 dark:text-slate-100 dark:hover:text-indigo-300"
                onClick={onHome}
              >
                <span className="mr-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm shadow-slate-950/20 dark:bg-white dark:text-slate-950">
                  <Wand2 size={17} />
                </span>
                <span className="min-w-0 truncate text-[15px] sm:text-base">ProductFlow</span>
              </button>
            ) : (
              <div className="flex min-w-0 items-center text-base font-semibold text-slate-950 dark:text-slate-100">
                <span className="mr-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm shadow-slate-950/20 dark:bg-white dark:text-slate-950">
                  <Wand2 size={17} />
                </span>
                <span className="min-w-0 truncate text-[15px] sm:text-base">ProductFlow</span>
              </div>
            )}
            {breadcrumbs ? (
              <div className="hidden min-w-0 items-center gap-2 2xl:flex">
                <span className="text-slate-300 dark:text-slate-700">/</span>
                <span className="truncate font-medium text-slate-600 dark:text-slate-400">{breadcrumbs}</span>
              </div>
            ) : null}
          </div>

          <div ref={desktopNavAreaRef} className="hidden min-w-0 flex-1 justify-center md:flex">
            <div className="relative flex max-w-full min-w-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1 shadow-inner shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-none">
              <div className="flex min-w-0 items-center gap-1">
                {desktopVisibleNavItems.map((item) => renderDesktopNavItem(item))}
                {desktopOverflowNavItems.length ? (
                  <div
                    ref={desktopMoreMenuRef}
                    className="relative"
                    onPointerEnter={() => {
                      clearDesktopMoreCloseTimer();
                      setDesktopMoreOpen(true);
                    }}
                    onPointerLeave={scheduleDesktopMoreClose}
                    onBlur={(event) => {
                      const nextTarget = event.relatedTarget;
                      if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                        clearDesktopMoreCloseTimer();
                        setDesktopMoreOpen(false);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        clearDesktopMoreCloseTimer();
                        setDesktopMoreOpen(false);
                      }
                    }}
                  >
                    <button
                      type="button"
                      aria-label={t("nav.more")}
                      aria-haspopup="menu"
                      aria-expanded={desktopMoreOpen}
                      className={navItemClassName(desktopOverflowActive || desktopMoreOpen)}
                      onClick={() => {
                        clearDesktopMoreCloseTimer();
                        setDesktopMoreOpen(true);
                      }}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                    <div
                      role="menu"
                      aria-label={t("nav.more")}
                      aria-hidden={!desktopMoreOpen}
                      className={desktopMoreMenuClassName(desktopMoreOpen)}
                    >
                      {desktopOverflowNavItems.map((item) => {
                        const Icon = item.icon;
                        const active = item.match(location.pathname);
                        const label = t(item.labelKey);
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            role="menuitem"
                            aria-current={active ? "page" : undefined}
                            className={menuItemClassName(active)}
                            onClick={() => {
                              clearDesktopMoreCloseTimer();
                              setDesktopMoreOpen(false);
                            }}
                          >
                            <Icon size={16} aria-hidden="true" />
                            <span className="truncate">{label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
              <div
                ref={desktopMeasureRowRef}
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 flex items-center gap-1 opacity-0"
              >
                {visibleNavItems.map((item) => renderDesktopNavMeasurementItem(item))}
                <span ref={desktopMoreMeasureRef} className={navItemClassName(false)}>
                  <MoreHorizontal size={16} aria-hidden="true" />
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 md:hidden">
            {renderPreferenceControls()}
          </div>

          <div className="hidden shrink-0 items-center justify-end gap-1.5 md:flex">
            {renderPreferenceControls()}
            {onLogout ? <AccountMenu identity={account} onLogout={onLogout} /> : null}
          </div>
        </div>
      </nav>

      {mobileMoreOpen ? (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-950/15 dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/40 md:hidden">
          <div className="grid gap-1">
            {onLogout ? (
              <div className="mb-1 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900">
                <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                  {account.displayName}
                </div>
                {account.username ? (
                  <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{account.username}</div>
                ) : null}
              </div>
            ) : null}
            {secondaryNavItems.map((item) => {
              const Icon = item.icon;
              const active = item.match(location.pathname);
              const label = t(item.labelKey);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={menuItemClassName(active)}
                  onClick={() => setMobileMoreOpen(false)}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                </Link>
              );
            })}
            {onLogout ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMoreOpen(false);
                  onLogout();
                }}
                className={menuItemClassName(false)}
              >
                <LogOut size={17} />
                <span>{t("nav.logout")}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        aria-label={t("nav.mobile")}
        className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/96 px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.4rem)] shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/94 dark:shadow-[0_-18px_40px_rgba(0,0,0,0.35)] md:hidden"
      >
        <div
          className="mx-auto grid w-full max-w-lg gap-1"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, mobileNavColumnCount)}, minmax(0, 1fr))` }}
        >
          {primaryNavItems.map((item) => {
            const Icon = item.icon;
            const active = item.match(location.pathname);
            const label = t(item.labelKey);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                className={mobileNavItemClassName(active)}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="mt-0.5 truncate">{label}</span>
              </Link>
            );
          })}
          {hasOverflowNav ? (
            <button
              type="button"
              onClick={() => setMobileMoreOpen((current) => !current)}
              aria-expanded={mobileMoreOpen}
              aria-label={t("nav.more")}
              className={mobileNavItemClassName(secondaryActive || mobileMoreOpen)}
            >
              <MoreHorizontal size={18} aria-hidden="true" />
              <span className="mt-0.5 truncate">{t("nav.more")}</span>
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
