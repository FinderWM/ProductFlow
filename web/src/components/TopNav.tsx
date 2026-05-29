import { useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
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
  Wand2,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { LOCALES, type Locale, type TranslationKey } from "../lib/i18n";
import { usePreferences } from "../lib/preferences";
import { hasSessionApiPermission, hasSessionMenu } from "../lib/rbac";
import { useSessionState } from "../lib/session";
import { THEME_PREFERENCES, type ThemePreference } from "../lib/theme";

interface TopNavProps {
  breadcrumbs?: string;
  onHome?: () => void;
  onLogout?: () => void;
}

const navItems: Array<{
  labelKey: TranslationKey;
  to: string;
  menuCode: string | null;
  requiredPermission?: string;
  priority: "primary" | "secondary";
  icon: typeof Activity;
  match: (pathname: string) => boolean;
}> = [
  {
    labelKey: "nav.products",
    to: "/products",
    menuCode: "inspirations",
    priority: "primary",
    icon: LayoutGrid,
    match: (pathname: string) => pathname.startsWith("/products") && !pathname.endsWith("/image-chat"),
  },
  {
    labelKey: "nav.imageChat",
    to: "/image-chat",
    menuCode: "image_chat",
    priority: "primary",
    icon: MessagesSquare,
    match: (pathname: string) => pathname.includes("image-chat"),
  },
  {
    labelKey: "nav.gallery",
    to: "/gallery",
    menuCode: "gallery",
    priority: "primary",
    icon: GalleryHorizontalEnd,
    match: (pathname: string) => pathname.startsWith("/gallery"),
  },
  {
    labelKey: "nav.help",
    to: "/help",
    menuCode: null,
    priority: "secondary",
    icon: BookOpen,
    match: (pathname: string) => pathname.startsWith("/help"),
  },
  {
    labelKey: "nav.status",
    to: "/status",
    menuCode: "status",
    priority: "primary",
    icon: Activity,
    match: (pathname: string) => pathname.startsWith("/status"),
  },
  {
    labelKey: "nav.usageStats",
    to: "/usage-stats",
    menuCode: "usage_stats",
    priority: "secondary",
    icon: BarChart3,
    match: (pathname: string) => pathname.startsWith("/usage-stats"),
  },
  {
    labelKey: "nav.settings",
    to: "/settings",
    menuCode: "settings",
    requiredPermission: "settings:read",
    priority: "primary",
    icon: Settings,
    match: (pathname: string) => pathname.startsWith("/settings"),
  },
  {
    labelKey: "nav.rbac",
    to: "/rbac",
    menuCode: "rbac",
    priority: "secondary",
    icon: ShieldCheck,
    match: (pathname: string) => pathname.startsWith("/rbac"),
  },
];

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

export function TopNav({ breadcrumbs, onHome, onLogout }: TopNavProps) {
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const location = useLocation();
  const { locale, setLocale, t, themePreference, setThemePreference } = usePreferences();
  const session = useSessionState();
  const visibleNavItems = navItems.filter(
    (item) =>
      item.menuCode === null ||
      (hasSessionMenu(session, item.menuCode) &&
        (!item.requiredPermission || hasSessionApiPermission(session, item.requiredPermission))),
  );
  const CurrentThemeIcon = themeIcons[themePreference];
  const nextThemePreference =
    THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(themePreference) + 1) % THEME_PREFERENCES.length];
  const nextLocale = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length];
  const primaryNavItems = visibleNavItems.filter((item) => item.priority === "primary");
  const secondaryNavItems = visibleNavItems.filter((item) => item.priority === "secondary");
  const secondaryActive = secondaryNavItems.some((item) => item.match(location.pathname));
  const hasOverflowNav = secondaryNavItems.length > 0 || Boolean(onLogout);
  const mobileNavColumnCount = primaryNavItems.length + (hasOverflowNav ? 1 : 0);

  const renderDesktopNavItem = (item: (typeof navItems)[number], compact = false) => {
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
        <span className={compact ? "hidden min-[1440px]:inline" : "inline"}>{label}</span>
      </Link>
    );
  };

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/94 px-3 py-3 shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-xl dark:border-slate-800 dark:bg-[#070b13]/94 sm:px-4 lg:px-5">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm md:min-w-40 md:shrink-0 lg:min-w-44 2xl:w-64">
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
            {breadcrumbs ? (
              <div className="hidden min-w-0 items-center gap-2 2xl:flex">
                <span className="text-slate-300 dark:text-slate-700">/</span>
                <span className="truncate font-medium text-slate-600 dark:text-slate-400">{breadcrumbs}</span>
              </div>
            ) : null}
          </div>

          <div className="hidden min-w-0 flex-1 justify-center md:flex">
            <div className="flex min-w-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1 shadow-inner shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-none">
              <div className="hidden items-center gap-1 min-[1440px]:flex">
                {visibleNavItems.map((item) => renderDesktopNavItem(item))}
              </div>
              <div className="flex items-center gap-1 min-[1440px]:hidden">
                {primaryNavItems.map((item) => renderDesktopNavItem(item, true))}
                {secondaryNavItems.length ? (
                  <div className="group relative">
                    <button
                      type="button"
                      aria-label={t("nav.more")}
                      className={navItemClassName(secondaryActive)}
                    >
                      <MoreHorizontal size={16} />
                      <span className="hidden min-[1440px]:inline">{t("nav.more")}</span>
                    </button>
                    <div className="invisible absolute right-0 top-12 z-50 w-56 translate-y-1 rounded-xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl shadow-slate-950/10 transition group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/30">
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
                          >
                            <Icon size={16} />
                            <span className="truncate">{label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 md:hidden">
            <button
              type="button"
              onClick={() => setLocale(nextLocale)}
              aria-label={`${t("nav.language")}: ${t(localeLabelKey[locale])}`}
              title={t(localeLabelKey[locale])}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors active:scale-[0.98] hover:border-indigo-200 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:text-violet-100"
            >
              <Languages size={16} />
            </button>
            <button
              type="button"
              onClick={() => setThemePreference(nextThemePreference)}
              aria-label={`${t("nav.theme")}: ${t(`theme.${themePreference}`)}`}
              title={t(`theme.${themePreference}`)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors active:scale-[0.98] hover:border-indigo-200 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:text-violet-100"
            >
              <CurrentThemeIcon size={16} />
            </button>
          </div>

          <div className="hidden shrink-0 items-center justify-end gap-1.5 md:flex">
            <button
              type="button"
              onClick={() => setLocale(nextLocale)}
              aria-label={`${t("nav.language")}: ${t(localeLabelKey[locale])}`}
              title={t(localeLabelKey[locale])}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-slate-100 min-[1440px]:hidden"
            >
              <Languages size={14} aria-hidden="true" />
            </button>
            <div className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900 min-[1440px]:inline-flex">
              <Languages size={14} className="ml-1 text-slate-400" aria-hidden="true" />
              {LOCALES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setLocale(item)}
                  aria-label={`${t("nav.language")}: ${t(localeLabelKey[item])}`}
                  className={`h-7 rounded-md px-2 text-xs font-semibold transition-colors ${
                    locale === item
                      ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-800 dark:text-indigo-300"
                      : "text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100"
                  }`}
                >
                  {t(localeLabelKey[item])}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setThemePreference(nextThemePreference)}
              aria-label={`${t("nav.theme")}: ${t(`theme.${themePreference}`)}`}
              title={t(`theme.${themePreference}`)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-slate-100 min-[1440px]:hidden"
            >
              <CurrentThemeIcon size={14} aria-hidden="true" />
            </button>
            <div className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900 min-[1440px]:inline-flex">
              {THEME_PREFERENCES.map((item) => {
                const Icon = themeIcons[item];
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setThemePreference(item)}
                    aria-label={`${t("nav.theme")}: ${t(`theme.${item}`)}`}
                    title={t(`theme.${item}`)}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                      themePreference === item
                        ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-800 dark:text-indigo-300"
                        : "text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100"
                    }`}
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            </div>
            {onLogout ? (
              <button
                type="button"
                onClick={onLogout}
                aria-label={t("nav.logout")}
                title={t("nav.logout")}
                className="flex h-9 items-center rounded-lg px-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 min-[1440px]:px-3"
              >
                <LogOut size={15} className="min-[1440px]:mr-1.5" /> <span className="hidden min-[1440px]:inline">{t("nav.logout")}</span>
              </button>
            ) : null}
          </div>
        </div>
      </nav>

      {mobileMoreOpen ? (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-50 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-950/15 dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/40 md:hidden">
          <div className="grid gap-1">
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
