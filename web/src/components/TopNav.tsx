import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Flower2,
  Languages,
  LayoutDashboard,
  Leaf,
  Loader2,
  LogOut,
  MoreHorizontal,
  Monitor,
  Moon,
  RefreshCw,
  Rose,
  Settings,
  ShieldCheck,
  Sun,
  Trees,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { FloatingSurface } from "./FloatingSurface";
import { useCurrentWeather, weatherGeocodingLanguage } from "../lib/currentWeather";
import { LOCALES, type Locale, type TranslationKey } from "../lib/i18n";
import { usePreferences } from "../lib/preferences";
import {
  API_GALLERY_READ,
  API_GLOBAL_TEMPLATES_MANAGE,
  API_IMAGE_CHAT_READ,
  API_INSPIRATIONS_READ,
  API_SETTINGS_READ,
  API_STATUS_READ,
  API_USAGE_STATS_READ,
  hasRbacManagementAccess,
  hasSessionMenuApiPermission,
} from "../lib/rbac";
import { useSessionActions } from "../lib/sessionActions";
import { useSessionState } from "../lib/session";
import { THEME_PREFERENCES, type ThemePreference } from "../lib/theme";
import { UI_LAYOUT_SCHEME_METADATA, type UiLayoutScheme } from "../lib/uiLayoutScheme";
import type { CurrentWeather, CurrentWeatherCondition, SessionState, SessionUser } from "../lib/types";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import {
  WORKSPACE_APPEARANCE_METADATA,
  type WorkspaceAppearance,
  workspaceAppearanceResolvedTheme,
} from "../lib/workspaceAppearance";
import {
  isBadWeatherCondition,
  isExtremeWeather,
  weatherConditionTranslationKey,
  weatherLocationDisplayName,
} from "../lib/weather";
import { searchWeatherLocations, weatherSources } from "../lib/weatherSources";

interface TopNavProps {
  /** Kept for page compatibility; global top nav no longer renders repeated page titles. */
  breadcrumbs?: string;
  onHome?: () => void;
  onLogout?: () => void;
}

type NavPriority = "primary" | "secondary";

interface TopNavItem {
  labelKey: TranslationKey;
  to: string;
  workspaceTo?: string;
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

export interface DesktopNavAvailableWidthInput {
  navAreaWidth: number;
  rightSlotWidth: number;
  rightControlsWidth: number;
  horizontalChrome?: number;
}

export interface WorkspaceNavLayoutInput {
  key: string;
  priority: NavPriority;
  width: number;
}

export interface WorkspaceNavAvailableWidthInput {
  viewportWidth: number;
  brandWidth: number;
  horizontalChrome?: number;
  brandGap?: number;
}

export interface WorkspaceThemeDockRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface WorkspaceTopNavTargetInput {
  to: string;
  workspaceTo?: string;
}

const DESKTOP_NAV_GAP_PX = 4;
const DESKTOP_NAV_HORIZONTAL_CHROME_PX = 36;
const WORKSPACE_NAV_HORIZONTAL_CHROME_PX = 36;
const WORKSPACE_BRAND_NAV_GAP_PX = 14;
const NAV_AUTO_HIDE_DELAY_MS = 5_000;
const WORKSPACE_THEME_DOCK_REVEAL_MARGIN_PX = 16;
const CURTAIN_EASING = "cubic-bezier(0.18, 0.9, 0.2, 1.12)";
export const TOP_CHROME_COLLAPSED_SAFE_HEIGHT_CLASS = "h-[4.5rem] md:h-[4.65rem]";
const TOP_CHROME_OPEN_HEIGHT_CLASS = "h-[4.75rem] md:h-[4.65rem]";

const navItems: TopNavItem[] = [
  {
    labelKey: "nav.resourceLibrary",
    to: "/resource-library",
    menuCode: null,
    priority: "primary",
    icon: Trees,
    match: (pathname: string) => pathname.startsWith("/resource-library"),
  },
  {
    labelKey: "nav.inspirations",
    to: "/inspirations",
    workspaceTo: "/inspirations/list",
    menuCode: "inspirations",
    requiredPermission: API_INSPIRATIONS_READ,
    priority: "primary",
    icon: Flower2,
    match: (pathname: string) => pathname.startsWith("/inspirations") && !pathname.endsWith("/image-chat"),
  },
  {
    labelKey: "nav.templates",
    to: "/workflow/templates",
    menuCode: "inspirations",
    requiredPermission: API_INSPIRATIONS_READ,
    priority: "secondary",
    icon: LayoutDashboard,
    match: (pathname: string) => pathname.startsWith("/workflow/templates"),
  },
  {
    labelKey: "nav.imageChat",
    to: "/image-chat",
    workspaceTo: "/image-chat/workbench",
    menuCode: "image_chat",
    requiredPermission: API_IMAGE_CHAT_READ,
    priority: "primary",
    icon: Leaf,
    match: (pathname: string) => pathname.includes("image-chat"),
  },
  {
    labelKey: "nav.gallery",
    to: "/gallery",
    workspaceTo: "/gallery/manage",
    menuCode: "gallery",
    requiredPermission: API_GALLERY_READ,
    priority: "primary",
    icon: Rose,
    match: (pathname: string) => pathname.startsWith("/gallery"),
  },
  {
    labelKey: "nav.status",
    to: "/status",
    workspaceTo: "/status/detail",
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
    priority: "primary",
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
    match: (pathname: string) => pathname === "/settings",
  },
  {
    labelKey: "nav.globalTemplates",
    to: "/settings/global-templates",
    menuCode: "settings",
    requiredPermission: API_GLOBAL_TEMPLATES_MANAGE,
    priority: "secondary",
    icon: Monitor,
    match: (pathname: string) => pathname.startsWith("/settings/global-templates"),
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

export function isPointerInWorkspaceThemeDockRevealZone({
  clientX,
  clientY,
  margin = WORKSPACE_THEME_DOCK_REVEAL_MARGIN_PX,
  rect,
}: {
  clientX: number;
  clientY: number;
  margin?: number;
  rect: WorkspaceThemeDockRect | null;
}): boolean {
  if (!rect) {
    return false;
  }
  return (
    clientX >= rect.left - margin &&
    clientX <= rect.right + margin &&
    clientY >= rect.top - margin &&
    clientY <= rect.bottom + margin
  );
}

function isExternalInteractiveElement(element: Element, root: HTMLElement): boolean {
  if (root.contains(element)) {
    return false;
  }
  const interactiveElement = element.closest(
    "button,a,input,textarea,select,[role='button'],[role='link'],[tabindex]:not([tabindex='-1'])",
  );
  return interactiveElement instanceof HTMLElement && !root.contains(interactiveElement);
}

function childrenVisualWidth(element: HTMLElement): number {
  const childRects = Array.from(element.children)
    .map((child) => child.getBoundingClientRect())
    .filter((rect) => rect.width > 0);

  if (childRects.length === 0) {
    return element.scrollWidth;
  }

  const left = Math.min(...childRects.map((rect) => rect.left));
  const right = Math.max(...childRects.map((rect) => rect.right));
  return Math.max(0, right - left);
}

export function getDesktopNavAvailableWidth({
  navAreaWidth,
  rightSlotWidth,
  rightControlsWidth,
  horizontalChrome = DESKTOP_NAV_HORIZONTAL_CHROME_PX,
}: DesktopNavAvailableWidthInput): number {
  const rightControlsOverflowWidth = Math.max(0, safeWidth(rightControlsWidth) - safeWidth(rightSlotWidth));
  return Math.max(0, safeWidth(navAreaWidth) - safeWidth(horizontalChrome) - rightControlsOverflowWidth);
}

export function getWorkspaceNavAvailableWidth({
  viewportWidth,
  brandWidth,
  horizontalChrome = WORKSPACE_NAV_HORIZONTAL_CHROME_PX,
  brandGap = WORKSPACE_BRAND_NAV_GAP_PX,
}: WorkspaceNavAvailableWidthInput): number {
  const reservedBrandWidth = safeWidth(brandWidth) > 0 ? safeWidth(brandWidth) + safeWidth(brandGap) : 0;
  return Math.max(0, safeWidth(viewportWidth) - safeWidth(horizontalChrome) - reservedBrandWidth);
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
  const secondaryKeys = new Set(items.filter((item) => item.priority === "secondary").map((item) => item.key));
  const overflowKeys = new Set<string>(secondaryKeys);
  let visibleKeys = items.filter((item) => !secondaryKeys.has(item.key)).map((item) => item.key);
  const usableWidth = safeWidth(availableWidth);

  if (items.length === 0 || usableWidth <= 0) {
    return {
      visibleKeys,
      overflowKeys: items.map((item) => item.key).filter((key) => overflowKeys.has(key)),
    };
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

export function getWorkspaceNavLayout({
  items,
  availableWidth,
  fixedControlWidths,
  moreButtonWidth,
  gap = 10,
}: {
  items: WorkspaceNavLayoutInput[];
  availableWidth: number;
  fixedControlWidths: number[];
  moreButtonWidth: number;
  gap?: number;
}): DesktopNavLayout {
  const itemByKey = new Map(items.map((item) => [item.key, item]));
  const overflowKeys = new Set(items.filter((item) => item.priority === "secondary").map((item) => item.key));
  let visibleKeys = items.filter((item) => item.priority !== "secondary").map((item) => item.key);
  const usableWidth = safeWidth(availableWidth);

  if (items.length === 0) {
    return { visibleKeys: [], overflowKeys: [] };
  }
  if (usableWidth <= 0) {
    return { visibleKeys: [], overflowKeys: items.map((item) => item.key) };
  }

  const getVisibleWidth = () => {
    const visibleWidths = visibleKeys.map((key) => itemByKey.get(key)?.width ?? 0);
    const controls = [
      ...fixedControlWidths,
      ...visibleWidths,
      ...(overflowKeys.size > 0 ? [moreButtonWidth] : []),
    ].filter((width) => safeWidth(width) > 0);
    return widthForControls(controls, Math.max(0, gap));
  };

  while (visibleKeys.length > 0 && getVisibleWidth() > usableWidth) {
    const nextOverflowKey = visibleKeys.at(-1);
    if (!nextOverflowKey) {
      break;
    }
    overflowKeys.add(nextOverflowKey);
    visibleKeys = visibleKeys.slice(0, -1);
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

const workspaceAppearanceIcons: Record<WorkspaceAppearance, typeof Sun> = {
  mist: Sun,
  sage: Leaf,
  dusk: Moon,
};

const weatherConditionIcons: Record<CurrentWeatherCondition, LucideIcon> = {
  clear: Sun,
  partly_cloudy: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  thunderstorm: CloudLightning,
};

function weatherIconFor(weather: CurrentWeather | null, fallbackIsDay: boolean): LucideIcon {
  if (!weather) {
    return fallbackIsDay ? Sun : Moon;
  }
  if (weather.condition === "clear") {
    return weather.is_day ? Sun : Moon;
  }
  if (weather.condition === "partly_cloudy") {
    return weather.is_day ? CloudSun : CloudMoon;
  }
  return weatherConditionIcons[weather.condition];
}

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

const workspaceLocaleMarkers: Record<Locale, string> = {
  "zh-CN": "简",
  "en-US": "EN",
  "ja-JP": "日",
};

const workspaceMoreOrder: TranslationKey[] = [
  "nav.usageStats",
  "nav.rbac",
  "nav.help",
  "nav.templates",
  "nav.globalTemplates",
];

const WORKSPACE_HOME_PATH = "/inspirations";

function workspaceActionLabel(locale: Locale): string {
  if (locale === "en-US") {
    return "Actions";
  }
  if (locale === "ja-JP") {
    return "操作";
  }
  return "操作";
}

function workspaceOrderedItems(items: TopNavItem[]): TopNavItem[] {
  const order = new Map(workspaceMoreOrder.map((labelKey, index) => [labelKey, index]));
  return [...items].sort((left, right) => {
    const leftIndex = order.get(left.labelKey) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.labelKey) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

export function workspaceTopNavTarget(item: WorkspaceTopNavTargetInput): string {
  return item.workspaceTo ?? item.to;
}

function isWorkspaceNavItemActive(item: TopNavItem, pathname: string): boolean {
  return item.match(pathname);
}

function navItemClassName(active: boolean) {
  return [
    "pf-shell-nav-item inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors",
    active
      ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700"
      : "text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100",
  ].join(" ");
}

function menuItemClassName(active: boolean) {
  return [
    "pf-shell-menu-item flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition-colors",
    active
      ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white",
  ].join(" ");
}

function mobileNavItemClassName(active: boolean) {
  return [
    "flex min-h-14 min-w-0 flex-col items-center justify-center rounded-xl px-0.5 text-[10px] font-semibold transition-colors active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400",
    active
      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-900 dark:hover:text-white",
  ].join(" ");
}

function mobileMoreMenuItemClassName(active: boolean) {
  return [
    "pf-shell-mobile-menu-item flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold transition-colors",
    active
      ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white",
  ].join(" ");
}

function mobilePreferenceOptionClassName(active: boolean) {
  return [
    "pf-shell-mobile-preference-option flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-center text-xs font-semibold transition-colors active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400",
    active
      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white",
  ].join(" ");
}

function preferenceTriggerClassName(hasMarker: boolean) {
  return [
    "pf-shell-preference-trigger inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white/80 text-sm font-semibold text-slate-600 shadow-sm shadow-slate-950/[0.03] transition-colors active:scale-[0.98] hover:border-slate-300 hover:bg-white hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300 dark:shadow-black/20 dark:hover:border-slate-500 dark:hover:bg-slate-900 dark:hover:text-slate-100",
    hasMarker ? "min-w-16 gap-1.5 px-2" : "w-9 px-0",
  ].join(" ");
}

function preferenceMenuClassName() {
  return "pf-shell-menu-surface w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/30";
}

function accountMenuClassName() {
  return "pf-shell-account-surface w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/30";
}

function weatherMenuClassName() {
  return "pf-shell-weather-surface w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/30";
}

function weatherInfoClassName() {
  return "pf-shell-weather-surface w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/30";
}

function weatherTriggerClassName(emphasis: "default" | "warning" | "danger") {
  return [
    "pf-shell-weather-trigger inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 !bg-white !text-black shadow-sm shadow-slate-950/[0.06] transition-colors hover:!bg-white hover:border-slate-300 hover:!text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:!bg-white dark:!text-black dark:shadow-black/20 dark:hover:!bg-white dark:hover:border-slate-500 dark:hover:!text-black dark:focus-visible:ring-violet-400",
    emphasis === "danger"
      ? "border-red-300 ring-2 ring-red-100 hover:border-red-400 dark:border-red-300 dark:ring-red-200"
      : emphasis === "warning"
        ? "border-amber-300 ring-2 ring-amber-100 hover:border-amber-400 dark:border-amber-300 dark:ring-amber-200"
        : "",
  ].join(" ");
}

function weatherEmphasisTextClassName(emphasis: "default" | "warning" | "danger") {
  if (emphasis === "danger") {
    return "text-red-600 dark:text-red-300";
  }
  if (emphasis === "warning") {
    return "text-amber-700 dark:text-amber-200";
  }
  return "text-slate-950 dark:text-white";
}

function desktopMoreMenuClassName() {
  return "pf-shell-menu-surface w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-950/10 dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/30";
}

function curtainShellClassName(open: boolean) {
  return [
    "sticky top-0 z-50 overflow-visible transition-[height] duration-700",
    open ? TOP_CHROME_OPEN_HEIGHT_CLASS : TOP_CHROME_COLLAPSED_SAFE_HEIGHT_CLASS,
  ].join(" ");
}

function curtainPanelClassName(open: boolean) {
  return [
    "pf-shell-curtain-panel absolute inset-x-0 top-0 border-b border-slate-200 bg-white/94 px-3 py-3 shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-xl transition-[transform,opacity,filter] duration-700 will-change-transform dark:border-slate-800 dark:bg-[#070b13]/94 sm:px-4 lg:px-5",
    open
      ? "pointer-events-auto translate-y-0 opacity-100 blur-0"
      : "pointer-events-none -translate-y-[calc(100%-0.7rem)] opacity-0 blur-[1px]",
  ].join(" ");
}

function curtainHandleClassName(open: boolean) {
  return [
    "pf-shell-curtain-handle absolute left-1/2 z-[55] inline-flex h-7 w-16 -translate-x-1/2 items-center justify-center rounded-b-xl border border-t-0 border-slate-200 bg-white/95 text-slate-500 shadow-lg shadow-slate-950/10 backdrop-blur transition-[transform,opacity] duration-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-[#070b13]/95 dark:text-slate-300 dark:shadow-black/30 dark:focus-visible:ring-violet-400",
    open ? "pointer-events-none top-0 -translate-y-3 opacity-0" : "top-0 translate-y-0 opacity-100",
  ].join(" ");
}

function mobileBottomNavClassName(open: boolean) {
  return [
    "fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/96 px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.4rem)] shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur transition-[transform,opacity] duration-700 dark:border-slate-800 dark:bg-slate-950/94 dark:shadow-[0_-18px_40px_rgba(0,0,0,0.35)] md:hidden",
    open ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-[calc(100%-0.7rem)] opacity-0",
  ].join(" ");
}

function weatherTemperatureLabel(weather: CurrentWeather): string | null {
  return weather.temperature_celsius === null ? null : String(Math.round(weather.temperature_celsius));
}

function weatherTemperatureValue(weather: CurrentWeather): string {
  const temperature = weatherTemperatureLabel(weather);
  return temperature ? `${temperature}°C` : "--";
}

function weatherHumidityValue(weather: CurrentWeather): string | null {
  return weather.humidity_percent === null || weather.humidity_percent === undefined
    ? null
    : `${Math.round(weather.humidity_percent)}%`;
}

function weatherPressureValue(weather: CurrentWeather): string | null {
  return weather.pressure_hpa === null || weather.pressure_hpa === undefined
    ? null
    : `${Math.round(weather.pressure_hpa)} hPa`;
}

function formatWeatherTimestamp(value: string | null | undefined, locale: Locale): string {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function weatherTitle({
  fallbackIsDay,
  hasSavedLocation,
  locationName,
  t,
  weather,
}: {
  fallbackIsDay: boolean;
  hasSavedLocation: boolean;
  locationName: string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  weather: CurrentWeather | null;
}): string {
  if (weather) {
    const condition = t(weatherConditionTranslationKey(weather.condition));
    const temperature = weatherTemperatureLabel(weather);
    if (locationName) {
      return temperature
        ? t("weather.currentWithLocation", { location: locationName, condition, temperature })
        : t("weather.currentWithLocationNoTemperature", { location: locationName, condition });
    }
    return temperature
      ? t("weather.current", { condition, temperature })
      : t("weather.currentNoTemperature", { condition });
  }
  if (hasSavedLocation) {
    return t("weather.loading");
  }
  return t(fallbackIsDay ? "weather.defaultDay" : "weather.defaultNight");
}

function workspaceWeatherSummary({
  fallbackIsDay,
  hasSavedLocation,
  locationName,
  t,
  weather,
}: {
  fallbackIsDay: boolean;
  hasSavedLocation: boolean;
  locationName: string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  weather: CurrentWeather | null;
}): string {
  if (weather) {
    const condition = t(weatherConditionTranslationKey(weather.condition));
    const temperature = weatherTemperatureLabel(weather);
    if (locationName) {
      return temperature ? `${locationName} ${temperature}°C / ${condition}` : `${locationName} / ${condition}`;
    }
    return temperature ? `${temperature}°C / ${condition}` : condition;
  }
  if (locationName) {
    return `${locationName} / ${hasSavedLocation ? t("weather.loading") : t(fallbackIsDay ? "weather.defaultDay" : "weather.defaultNight")}`;
  }
  if (hasSavedLocation) {
    return t("weather.loading");
  }
  return t(fallbackIsDay ? "weather.defaultDay" : "weather.defaultNight");
}

function preferenceMenuItemClassName(active: boolean) {
  return [
    "pf-shell-menu-item flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-semibold transition-colors",
    active
      ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
  ].join(" ");
}

function preferenceBadgeClassName(active: boolean) {
  return [
    "pf-shell-badge inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border px-1.5 text-[11px] font-bold leading-none",
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

function MobilePreferenceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<PreferenceOption<T>>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="pf-shell-control-group border-t border-slate-200 pt-1.5 dark:border-slate-800">
      <div className="pf-shell-section-label px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(options.length, 3))}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const active = option.value === value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              className={mobilePreferenceOptionClassName(active)}
              onClick={() => onChange(option.value)}
            >
              {Icon ? (
                <Icon size={16} aria-hidden="true" />
              ) : (
                <span className={preferenceBadgeClassName(active)}>{option.marker}</span>
              )}
              <span className="min-w-0 truncate">{option.label}</span>
              <Check
                size={14}
                aria-hidden="true"
                className={active ? "shrink-0 text-current" : "hidden"}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
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
      <FloatingSurface
        open={open}
        triggerRef={triggerRef}
        preferredPlacement="bottom-end"
        layer="modal"
        matchTriggerWidth={false}
        onOpenChange={setOpen}
        className={preferenceMenuClassName()}
      >
      <div role="menu" aria-label={label}>
        <div className="pf-shell-section-label px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
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
                className={active ? "pf-shell-check text-indigo-600 dark:text-violet-300" : "text-transparent"}
              />
            </button>
          );
        })}
      </div>
      </FloatingSurface>
    </div>
  );
}

function AccountMenu({ identity, onLogout }: { identity: AccountIdentity; onLogout: () => void }) {
  const { t } = usePreferences();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const accountLabel = identity.username
    ? `${identity.displayName} · ${identity.username}`
    : identity.displayName;

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${t("nav.accountMenu")}: ${accountLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={accountLabel}
        className="pf-shell-preference-trigger inline-flex h-10 max-w-[220px] items-center gap-2 rounded-lg border border-slate-200 bg-white/85 px-2 text-left text-sm shadow-sm shadow-slate-950/[0.03] transition-colors hover:border-slate-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/70 dark:shadow-black/20 dark:hover:border-slate-500 dark:hover:bg-slate-900 dark:focus-visible:ring-violet-400 xl:max-w-[260px]"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="pf-shell-trigger-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
          <UserRound size={15} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="pf-shell-trigger-title block truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
            {identity.displayName}
          </span>
          {identity.username ? (
            <span className="pf-shell-trigger-subtitle block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {identity.username}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`pf-shell-trigger-chevron shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <FloatingSurface
        open={open}
        triggerRef={triggerRef}
        preferredPlacement="bottom-end"
        layer="modal"
        matchTriggerWidth={false}
        onOpenChange={setOpen}
        className={accountMenuClassName()}
      >
      <div role="menu" aria-label={t("nav.accountMenu")}>
        <div role="presentation" className="pf-shell-account-summary rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
          <div className="pf-shell-section-label text-[11px] font-semibold text-slate-400 dark:text-slate-500">
            {t("nav.currentAccount")}
          </div>
          <div className="pf-shell-value mt-1 truncate text-sm font-semibold text-slate-950 dark:text-white">
            {identity.displayName}
          </div>
          {identity.username ? (
            <div className="pf-shell-muted mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{identity.username}</div>
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
      </FloatingSurface>
    </div>
  );
}

function WorkspaceAccountMenu({
  containerRef,
  identity,
  onLogout,
}: {
  containerRef?: Ref<HTMLDivElement>;
  identity: AccountIdentity;
  onLogout: () => void;
}) {
  const { t } = usePreferences();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const accountLabel = identity.username
    ? `${identity.displayName} · ${identity.username}`
    : identity.displayName;

  return (
    <div
      ref={containerRef}
      className="pf-shell-profile-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${t("nav.profile")}: ${accountLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={accountLabel}
        className="pf-shell-profile-button"
        onClick={() => setOpen((current) => !current)}
      >
        <UserRound size={15} aria-hidden="true" />
        <span className="pf-shell-profile-button-label">{identity.displayName}</span>
      </button>
      <FloatingSurface
        open={open}
        triggerRef={triggerRef}
        preferredPlacement="bottom-end"
        layer="modal"
        matchTriggerWidth={false}
        minWidth={230}
        offset={12}
        margin={12}
        onOpenChange={setOpen}
        className="pf-shell-profile-panel"
      >
        <div role="menu" aria-label={t("nav.profile")}>
          <div className="pf-shell-profile-summary" role="presentation">
            <span className="pf-shell-profile-label">{t("nav.currentAccount")}</span>
            <strong>{identity.displayName}</strong>
            {identity.username ? <small>{identity.username}</small> : null}
          </div>
          <button
            type="button"
            role="menuitem"
            className="pf-shell-profile-logout"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut size={14} aria-hidden="true" />
            <span>{t("nav.logout")}</span>
          </button>
        </div>
      </FloatingSurface>
    </div>
  );
}

function WeatherControl() {
  const { locale, t } = usePreferences();
  const weatherState = useCurrentWeather();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [draftLocation, setDraftLocation] = useState(weatherState.savedLocationQuery);
  const [searchQuery, setSearchQuery] = useState("");
  const [localErrorKey, setLocalErrorKey] = useState<TranslationKey | null>(null);
  const infoCloseTimerRef = useRef<number | null>(null);
  const locationName = weatherLocationDisplayName(weatherState.resolvedLocation) || weatherState.savedLocationQuery;
  const locationSearchResult = useQuery({
    queryKey: [
      "weather-location-options",
      weatherState.weatherSourceId,
      searchQuery,
      weatherGeocodingLanguage(locale),
    ],
    queryFn: () =>
      searchWeatherLocations(weatherState.weatherSourceId, {
        query: searchQuery,
        language: weatherGeocodingLanguage(locale),
      }),
    enabled: open && searchQuery.trim().length > 0,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const WeatherIcon = weatherIconFor(weatherState.weather, weatherState.fallbackIsDay);
  const TriggerIcon = weatherState.isLoading && weatherState.hasSavedLocation ? Loader2 : WeatherIcon;
  const baseTriggerLabel = weatherTitle({
    fallbackIsDay: weatherState.fallbackIsDay,
    hasSavedLocation: weatherState.hasSavedLocation,
    locationName,
    t,
    weather: weatherState.weather,
  });
  const searchEmpty =
    searchQuery.trim().length > 0 && locationSearchResult.isSuccess && locationSearchResult.data.length === 0;
  const searchErrorKey = locationSearchResult.error
    ? "weather.locationFailed"
    : searchEmpty
      ? "weather.locationNotFound"
      : null;
  const statusErrorKey = localErrorKey ?? searchErrorKey ?? weatherState.errorKey;
  const triggerLabel = statusErrorKey ? t(statusErrorKey) : baseTriggerLabel;
  const statusText = statusErrorKey
    ? t(statusErrorKey)
    : locationSearchResult.isLoading
      ? t("weather.searchingLocations")
      : weatherState.hasSavedLocation
        ? weatherState.isLoading
          ? t("weather.loading")
          : t("weather.savedLocation", { location: locationName || weatherState.savedLocationQuery })
        : triggerLabel;
  const weatherConditionLabel = weatherState.weather
    ? t(weatherConditionTranslationKey(weatherState.weather.condition))
    : null;
  const badWeather = weatherState.weather ? isBadWeatherCondition(weatherState.weather.condition) : false;
  const extremeWeather = weatherState.weather ? isExtremeWeather(weatherState.weather) : false;
  const weatherEmphasis = extremeWeather ? "danger" : badWeather ? "warning" : "default";
  const humidityValue = weatherState.weather ? weatherHumidityValue(weatherState.weather) : null;
  const pressureValue = weatherState.weather ? weatherPressureValue(weatherState.weather) : null;
  const weatherInfoTitle = statusErrorKey ? t(statusErrorKey) : baseTriggerLabel;
  const nextRefreshMinutes = weatherState.nextWeatherRefreshAt
    ? Math.max(0, Math.ceil((weatherState.nextWeatherRefreshAt - Date.now()) / 60_000))
    : weatherState.weatherRefreshMinutes;

  const clearInfoCloseTimer = useCallback(() => {
    if (infoCloseTimerRef.current === null) {
      return;
    }
    window.clearTimeout(infoCloseTimerRef.current);
    infoCloseTimerRef.current = null;
  }, []);

  const showInfo = useCallback(() => {
    clearInfoCloseTimer();
    setInfoOpen(true);
  }, [clearInfoCloseTimer]);

  const scheduleInfoClose = useCallback(() => {
    clearInfoCloseTimer();
    infoCloseTimerRef.current = window.setTimeout(() => {
      setInfoOpen(false);
      infoCloseTimerRef.current = null;
    }, 120);
  }, [clearInfoCloseTimer]);

  useEffect(() => () => clearInfoCloseTimer(), [clearInfoCloseTimer]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setInfoOpen(false);
    setDraftLocation(weatherState.savedLocationQuery);
    setSearchQuery("");
    setLocalErrorKey(null);
  }, [open, weatherState.savedLocationQuery]);

  return (
    <div
      className="group relative shrink-0"
      onPointerEnter={showInfo}
      onPointerLeave={scheduleInfoClose}
      onFocus={showInfo}
      onBlur={(event) => {
        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
          return;
        }
        scheduleInfoClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setInfoOpen(false);
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={weatherTriggerClassName(weatherEmphasis)}
        onClick={() => setOpen((current) => !current)}
      >
        <TriggerIcon
          size={17}
          aria-hidden="true"
          className={TriggerIcon === Loader2 ? "animate-spin" : undefined}
        />
      </button>
      <FloatingSurface
        open={infoOpen && !open}
        triggerRef={triggerRef}
        preferredPlacement="bottom-start"
        layer="popover"
        matchTriggerWidth={false}
        margin={8}
        onOpenChange={setInfoOpen}
        className={weatherInfoClassName()}
      >
      <div
        role="tooltip"
        onPointerEnter={showInfo}
        onPointerLeave={scheduleInfoClose}
        onFocus={showInfo}
        onBlur={scheduleInfoClose}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="pf-shell-section-label text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
              {t("weather.infoTitle")}
            </div>
            <div
              className={[
                "mt-1 truncate text-sm font-semibold",
                weatherEmphasisTextClassName(weatherEmphasis),
              ].join(" ")}
            >
              {weatherInfoTitle}
            </div>
          </div>
          <button
            type="button"
            disabled={!weatherState.resolvedLocation || weatherState.isRefreshingWeather}
            className="pf-shell-secondary-action inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-900 dark:hover:text-white"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void weatherState.refreshWeather();
            }}
          >
            <RefreshCw
              size={13}
              aria-hidden="true"
              className={weatherState.isRefreshingWeather ? "animate-spin" : undefined}
            />
            {t(weatherState.isRefreshingWeather ? "weather.refreshing" : "weather.refreshWeather")}
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          <dt className="pf-shell-section-label text-slate-400 dark:text-slate-500">{t("weather.infoCondition")}</dt>
          <dd
            className={[
              "font-medium",
              weatherEmphasis === "default"
                ? "pf-shell-value text-slate-700 dark:text-slate-200"
                : weatherEmphasisTextClassName(weatherEmphasis),
            ].join(" ")}
          >
            {weatherConditionLabel ?? "--"}
          </dd>
          <dt className="pf-shell-section-label text-slate-400 dark:text-slate-500">{t("weather.infoTemperature")}</dt>
          <dd className="pf-shell-value font-medium text-slate-700 dark:text-slate-200">
            {weatherState.weather ? weatherTemperatureValue(weatherState.weather) : "--"}
          </dd>
          {humidityValue ? (
            <>
              <dt className="pf-shell-section-label text-slate-400 dark:text-slate-500">{t("weather.infoHumidity")}</dt>
              <dd className="pf-shell-value font-medium text-slate-700 dark:text-slate-200">{humidityValue}</dd>
            </>
          ) : null}
          {pressureValue ? (
            <>
              <dt className="pf-shell-section-label text-slate-400 dark:text-slate-500">{t("weather.infoPressure")}</dt>
              <dd className="pf-shell-value font-medium text-slate-700 dark:text-slate-200">{pressureValue}</dd>
            </>
          ) : null}
          <dt className="pf-shell-section-label text-slate-400 dark:text-slate-500">{t("weather.infoObservedAt")}</dt>
          <dd className="pf-shell-value font-medium text-slate-700 dark:text-slate-200">
            {formatWeatherTimestamp(weatherState.weather?.observed_at, locale)}
          </dd>
          <dt className="pf-shell-section-label text-slate-400 dark:text-slate-500">{t("weather.infoSource")}</dt>
          <dd className="pf-shell-value font-medium text-slate-700 dark:text-slate-200">
            {t(weatherSources[weatherState.weatherSourceId].labelKey)}
          </dd>
          <dt className="pf-shell-section-label text-slate-400 dark:text-slate-500">{t("weather.infoNextRefresh")}</dt>
          <dd className="pf-shell-value font-medium text-slate-700 dark:text-slate-200">
            {t("weather.nextRefreshIn", { minutes: nextRefreshMinutes })}
          </dd>
        </dl>
      </div>
      </FloatingSurface>
      <FloatingSurface
        open={open}
        triggerRef={triggerRef}
        preferredPlacement="bottom-start"
        layer="modal"
        matchTriggerWidth={false}
        onOpenChange={setOpen}
        className={weatherMenuClassName()}
      >
      <div role="dialog" aria-label={t("weather.location")}>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const nextLocation = draftLocation.trim();
            if (!nextLocation) {
              setLocalErrorKey("weather.locationRequired");
              return;
            }
            setSearchQuery(nextLocation);
            setLocalErrorKey(null);
          }}
        >
          <label htmlFor="weather-location-input" className="pf-shell-section-label block text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t("weather.locationLabel")}
          </label>
          <div className="flex gap-2">
            <input
              id="weather-location-input"
              value={draftLocation}
              onChange={(event) => {
                setDraftLocation(event.target.value);
                setSearchQuery("");
                setLocalErrorKey(null);
              }}
              placeholder={t("weather.locationPlaceholder")}
              className="pf-shell-input h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-violet-400 dark:focus:ring-violet-400/20"
            />
            <button
              type="submit"
              className="pf-shell-primary-action inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white dark:focus-visible:ring-violet-400"
            >
              {locationSearchResult.isLoading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
              {t("weather.searchLocation")}
            </button>
          </div>
          {locationSearchResult.data?.length ? (
            <div className="pf-shell-soft-surface max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-950">
              {locationSearchResult.data.map((location) => {
                const label = weatherLocationDisplayName(location);
                return (
                  <button
                    key={`${location.latitude}:${location.longitude}:${label}`}
                    type="button"
                    className="pf-shell-list-option flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm transition hover:bg-white hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-900 dark:hover:text-white dark:focus-visible:ring-violet-400"
                    onClick={() => {
                      weatherState.setWeatherLocation(location, searchQuery || draftLocation);
                      setOpen(false);
                    }}
                  >
                    <span className="pf-shell-value min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
                      {label}
                    </span>
                    <span className="pf-shell-muted shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                      {location.latitude.toFixed(2)}, {location.longitude.toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <p
              className={[
                "min-w-0 flex-1 truncate text-xs font-medium",
                statusErrorKey ? "text-red-600 dark:text-red-300" : "pf-shell-muted text-slate-500 dark:text-slate-400",
              ].join(" ")}
            >
              {statusText}
            </p>
            <button
              type="button"
              className="pf-shell-secondary-action inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:ring-violet-400"
              onClick={() => {
                weatherState.clearWeatherLocation();
                setDraftLocation("");
                setLocalErrorKey(null);
              }}
            >
              <X size={13} aria-hidden="true" />
              {t("weather.clearLocation")}
            </button>
          </div>
        </form>
      </div>
      </FloatingSurface>
    </div>
  );
}

export function GlobalBrandMark({ to }: { to: string }) {
  return (
    <div className="pf-global-brand fixed left-4 top-3 z-[70] flex max-w-[calc(100vw-2rem)] items-center gap-2 text-sm sm:left-6 sm:max-w-[calc(100vw-3rem)] lg:left-8 lg:max-w-[calc(100vw-4rem)]">
      <WeatherControl />
      <Link
        to={to}
        aria-label="Inspiration One"
        className="pf-shell-brand-link min-w-0 truncate text-left text-[15px] font-semibold text-slate-950 transition-colors hover:text-indigo-700 focus:outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100 dark:hover:text-indigo-300 dark:focus-visible:ring-violet-400 sm:text-base"
      >
        Inspiration One
      </Link>
    </div>
  );
}

export function TopNav({ onLogout }: TopNavProps) {
  const { activeScheme, saveDefaultScheme: saveUserLayoutScheme } = useUiLayoutScheme();
  const desktopNavAreaRef = useRef<HTMLDivElement | null>(null);
  const desktopMeasureRowRef = useRef<HTMLDivElement | null>(null);
  const desktopMeasureItemRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const desktopMoreMeasureRef = useRef<HTMLSpanElement | null>(null);
  const desktopMoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const desktopMoreCloseTimerRef = useRef<number | null>(null);
  const desktopMorePinnedRef = useRef(false);
  const desktopRightControlsRef = useRef<HTMLDivElement | null>(null);
  const workspaceNavRef = useRef<HTMLElement | null>(null);
  const workspaceMeasureRowRef = useRef<HTMLDivElement | null>(null);
  const workspaceMeasureItemRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const workspaceMoreMeasureRef = useRef<HTMLSpanElement | null>(null);
  const workspaceBrandRef = useRef<HTMLDivElement | null>(null);
  const workspaceRuntimeRef = useRef<HTMLDivElement | null>(null);
  const workspaceLocaleRef = useRef<HTMLDivElement | null>(null);
  const workspaceProfileRef = useRef<HTMLDivElement | null>(null);
  const mobileMoreButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileMorePanelRef = useRef<HTMLDivElement | null>(null);
  const curtainRef = useRef<HTMLDivElement | null>(null);
  const curtainAutoHideTimerRef = useRef<number | null>(null);
  const workspaceThemeDockRef = useRef<HTMLDivElement | null>(null);
  const workspaceThemeDockRectRef = useRef<WorkspaceThemeDockRect | null>(null);
  const workspaceThemeDockAutoHideTimerRef = useRef<number | null>(null);
  const [desktopOverflowKeys, setDesktopOverflowKeys] = useState<string[]>([]);
  const [workspaceOverflowKeys, setWorkspaceOverflowKeys] = useState<string[]>([]);
  const [desktopMoreOpen, setDesktopMoreOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [curtainOpen, setCurtainOpen] = useState(true);
  const [workspaceThemeDockOpen, setWorkspaceThemeDockOpen] = useState(true);
  const [workspaceThemeDockPassThrough, setWorkspaceThemeDockPassThrough] = useState(false);
  const location = useLocation();
  const {
    locale,
    setLocale,
    t,
    themePreference,
    setThemePreference,
    workspaceAppearance,
    setWorkspaceAppearance,
  } = usePreferences();
  const weatherState = useCurrentWeather();
  const session = useSessionState();
  const sessionActions = useSessionActions();
  const logoutAction = onLogout ?? sessionActions.logout;
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
  const shellScheme = activeScheme === "workspace" ? "workspace" : "classic";
  const CurrentThemeIcon = shellScheme === "workspace" ? workspaceAppearanceIcons[workspaceAppearance] : themeIcons[themePreference];
  const themeOptions = THEME_PREFERENCES.map((theme) => ({
    value: theme,
    label: t(`theme.${theme}`),
    icon: themeIcons[theme],
  }));
  const workspaceAppearanceOptions = WORKSPACE_APPEARANCE_METADATA.map((appearance) => ({
    value: appearance.id,
    label: t(appearance.labelKey),
    icon: workspaceAppearanceIcons[appearance.id],
  }));
  const layoutSchemeOptions: Array<PreferenceOption<UiLayoutScheme>> = UI_LAYOUT_SCHEME_METADATA.filter(
    (scheme) => scheme.supported,
  ).map((scheme) => ({
    value: scheme.id,
    label: t(scheme.labelKey),
    icon: scheme.id === "workspace" ? LayoutDashboard : Monitor,
  }));
  const localeOptions = LOCALES.map((availableLocale) => ({
    value: availableLocale,
    label: t(localeLabelKey[availableLocale]),
    marker: localeMarkers[availableLocale],
  }));
  const primaryNavItems = visibleNavItems.filter((item) => item.priority === "primary");
  const secondaryNavItems = visibleNavItems.filter((item) => item.priority === "secondary");
  const workspaceOverflowKeySet = useMemo(() => new Set(workspaceOverflowKeys), [workspaceOverflowKeys]);
  const workspaceVisiblePrimaryNavItems = primaryNavItems.filter((item) => !workspaceOverflowKeySet.has(item.to));
  const workspaceCollapsedPrimaryNavItems = primaryNavItems.filter((item) => workspaceOverflowKeySet.has(item.to));
  const workspaceMoreNavItems = [
    ...workspaceCollapsedPrimaryNavItems.slice().reverse(),
    ...workspaceOrderedItems(secondaryNavItems),
  ];
  const secondaryActive = secondaryNavItems.some((item) => item.match(location.pathname));
  const hasOverflowNav = secondaryNavItems.length > 0 || Boolean(logoutAction);
  const mobileNavColumnCount = primaryNavItems.length + (hasOverflowNav ? 1 : 0);
  const desktopOverflowKeySet = useMemo(() => new Set(desktopOverflowKeys), [desktopOverflowKeys]);
  const desktopVisibleNavItems = visibleNavItems.filter((item) => !desktopOverflowKeySet.has(item.to));
  const desktopOverflowNavItems = visibleNavItems.filter((item) => desktopOverflowKeySet.has(item.to));
  const desktopOverflowActive = desktopOverflowNavItems.some((item) => item.match(location.pathname));
  const account = accountIdentity(session?.user, t("nav.account"));
  const workspaceWeatherLocationName =
    weatherLocationDisplayName(weatherState.resolvedLocation) || weatherState.savedLocationQuery;
  const workspaceBrandWeatherSummary = workspaceWeatherSummary({
    fallbackIsDay: weatherState.fallbackIsDay,
    hasSavedLocation: weatherState.hasSavedLocation,
    locationName: workspaceWeatherLocationName,
    t,
    weather: weatherState.weather,
  });
  const currentWorkspaceAppearanceLabel = t(
    WORKSPACE_APPEARANCE_METADATA.find((appearance) => appearance.id === workspaceAppearance)?.labelKey
      ?? "workspaceAppearance.mist.label",
  );
  const activeThemeOptions = shellScheme === "workspace" ? workspaceAppearanceOptions : themeOptions;
  const activeThemeValue = shellScheme === "workspace" ? workspaceAppearance : themePreference;
  const activeThemeLabel = shellScheme === "workspace" ? currentWorkspaceAppearanceLabel : t(`theme.${themePreference}`);

  function handleThemeControlChange(value: ThemePreference | WorkspaceAppearance) {
    if (shellScheme === "workspace") {
      const nextAppearance = value as WorkspaceAppearance;
      setWorkspaceAppearance(nextAppearance);
      setThemePreference(workspaceAppearanceResolvedTheme(nextAppearance));
      return;
    }
    setThemePreference(value as ThemePreference);
  }

  function handleLayoutSchemeChange(value: UiLayoutScheme) {
    saveUserLayoutScheme(value);
    if (value === "workspace") {
      setThemePreference(workspaceAppearanceResolvedTheme(workspaceAppearance));
    }
  }

  const clearCurtainAutoHideTimer = useCallback(() => {
    if (curtainAutoHideTimerRef.current !== null) {
      window.clearTimeout(curtainAutoHideTimerRef.current);
      curtainAutoHideTimerRef.current = null;
    }
  }, []);

  const scheduleCurtainAutoHide = useCallback(() => {
    clearCurtainAutoHideTimer();
    curtainAutoHideTimerRef.current = window.setTimeout(() => {
      setCurtainOpen(false);
      setDesktopMoreOpen(false);
      setMobileMoreOpen(false);
      curtainAutoHideTimerRef.current = null;
    }, NAV_AUTO_HIDE_DELAY_MS);
  }, [clearCurtainAutoHideTimer]);

  const keepCurtainOpen = useCallback(() => {
    setCurtainOpen(true);
    scheduleCurtainAutoHide();
  }, [scheduleCurtainAutoHide]);

  const clearWorkspaceThemeDockAutoHideTimer = useCallback(() => {
    if (workspaceThemeDockAutoHideTimerRef.current !== null) {
      window.clearTimeout(workspaceThemeDockAutoHideTimerRef.current);
      workspaceThemeDockAutoHideTimerRef.current = null;
    }
  }, []);

  const scheduleWorkspaceThemeDockAutoHide = useCallback(() => {
    clearWorkspaceThemeDockAutoHideTimer();
    workspaceThemeDockAutoHideTimerRef.current = window.setTimeout(() => {
      setWorkspaceThemeDockOpen(false);
      setWorkspaceThemeDockPassThrough(false);
      workspaceThemeDockAutoHideTimerRef.current = null;
    }, NAV_AUTO_HIDE_DELAY_MS);
  }, [clearWorkspaceThemeDockAutoHideTimer]);

  const keepWorkspaceThemeDockOpen = useCallback(() => {
    clearWorkspaceThemeDockAutoHideTimer();
    setWorkspaceThemeDockOpen(true);
    setWorkspaceThemeDockPassThrough(false);
  }, [clearWorkspaceThemeDockAutoHideTimer]);

  const clearDesktopMoreCloseTimer = useCallback(() => {
    if (desktopMoreCloseTimerRef.current !== null) {
      window.clearTimeout(desktopMoreCloseTimerRef.current);
      desktopMoreCloseTimerRef.current = null;
    }
  }, []);

  const scheduleDesktopMoreClose = useCallback(() => {
    if (desktopMorePinnedRef.current) {
      return;
    }
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
    const rightControls = desktopRightControlsRef.current;
    const rightSlotWidth = rightControls?.getBoundingClientRect().width ?? 0;
    const rightControlsWidth = rightControls
      ? Math.max(rightControls.scrollWidth, childrenVisualWidth(rightControls))
      : rightSlotWidth;

    if (layoutItems.some((item) => item.width <= 0) || moreButtonWidth <= 0) {
      setDesktopOverflowKeys((current) => (current.length === 0 ? current : []));
      return;
    }

    const layout = getDesktopNavLayout({
      items: layoutItems,
      availableWidth: getDesktopNavAvailableWidth({
        navAreaWidth: navArea.clientWidth,
        rightSlotWidth,
        rightControlsWidth,
      }),
      moreButtonWidth,
    });
    setDesktopOverflowKeys((current) => (arraysEqual(current, layout.overflowKeys) ? current : layout.overflowKeys));
  }, [location.pathname, visibleNavItems]);

  const updateWorkspaceNavLayout = useCallback(() => {
    const nav = workspaceNavRef.current;
    const moreMeasure = workspaceMoreMeasureRef.current;
    if (shellScheme !== "workspace" || !nav || !moreMeasure || typeof window === "undefined") {
      return;
    }
    if (window.matchMedia("(max-width: 980px)").matches || window.getComputedStyle(nav).display === "none") {
      setWorkspaceOverflowKeys((current) => (current.length === 0 ? current : []));
      return;
    }

    const navStyle = window.getComputedStyle(nav);
    const horizontalPadding = (Number.parseFloat(navStyle.paddingLeft) || 0) + (Number.parseFloat(navStyle.paddingRight) || 0);
    const brandWidth = workspaceBrandRef.current?.getBoundingClientRect().width ?? 0;
    const maxNavWidth = getWorkspaceNavAvailableWidth({
      viewportWidth: Math.min(window.innerWidth, nav.parentElement?.clientWidth ?? window.innerWidth),
      brandWidth,
    });
    const moreButtonWidth = moreMeasure.getBoundingClientRect().width;
    const requiredControlWidths = [
      workspaceRuntimeRef.current?.getBoundingClientRect().width ?? 0,
      workspaceLocaleRef.current?.getBoundingClientRect().width ?? 0,
    ];
    const fixedControlWidths = [
      ...requiredControlWidths,
      workspaceProfileRef.current?.getBoundingClientRect().width ?? 0,
    ];

    const layoutItems = visibleNavItems.map((item) => ({
      key: item.to,
      priority: item.priority,
      width: workspaceMeasureItemRefs.current[item.to]?.getBoundingClientRect().width ?? 0,
    }));
    if (
      layoutItems.some((item) => item.width <= 0) ||
      moreButtonWidth <= 0 ||
      brandWidth <= 0 ||
      requiredControlWidths.some((width) => width <= 0)
    ) {
      return;
    }

    const layout = getWorkspaceNavLayout({
      items: layoutItems,
      availableWidth: Math.max(0, maxNavWidth - horizontalPadding),
      fixedControlWidths,
      moreButtonWidth,
    });
    setWorkspaceOverflowKeys((current) => (arraysEqual(current, layout.overflowKeys) ? current : layout.overflowKeys));
  }, [shellScheme, visibleNavItems]);

  useLayoutEffect(() => {
    updateDesktopNavLayout();
    updateWorkspaceNavLayout();
  }, [locale, updateDesktopNavLayout, updateWorkspaceNavLayout, workspaceBrandWeatherSummary]);

  useEffect(
    () => () => {
      clearDesktopMoreCloseTimer();
      clearCurtainAutoHideTimer();
      clearWorkspaceThemeDockAutoHideTimer();
    },
    [clearCurtainAutoHideTimer, clearDesktopMoreCloseTimer, clearWorkspaceThemeDockAutoHideTimer],
  );

  useEffect(() => {
    setDesktopMoreOpen(false);
    desktopMorePinnedRef.current = false;
    setMobileMoreOpen(false);
    scheduleCurtainAutoHide();
    setWorkspaceThemeDockOpen(true);
    setWorkspaceThemeDockPassThrough(false);
    scheduleWorkspaceThemeDockAutoHide();
  }, [location.pathname, scheduleCurtainAutoHide, scheduleWorkspaceThemeDockAutoHide]);

  useEffect(() => {
    const handlePageActivity = () => {
      if (curtainOpen) {
        scheduleCurtainAutoHide();
      }
    };

    document.addEventListener("pointerdown", handlePageActivity, true);
    document.addEventListener("keydown", handlePageActivity, true);
    document.addEventListener("wheel", handlePageActivity, true);
    document.addEventListener("touchstart", handlePageActivity, true);
    return () => {
      document.removeEventListener("pointerdown", handlePageActivity, true);
      document.removeEventListener("keydown", handlePageActivity, true);
      document.removeEventListener("wheel", handlePageActivity, true);
      document.removeEventListener("touchstart", handlePageActivity, true);
    };
  }, [curtainOpen, scheduleCurtainAutoHide]);

  useEffect(() => {
    if (shellScheme !== "workspace" || typeof window === "undefined") {
      clearWorkspaceThemeDockAutoHideTimer();
      return;
    }

    const updateDockRect = () => {
      const dock = workspaceThemeDockRef.current;
      if (!dock) {
        return;
      }
      const rect = dock.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      workspaceThemeDockRectRef.current = {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      };
    };

    updateDockRect();

    const handlePointerMove = (event: PointerEvent) => {
      const dock = workspaceThemeDockRef.current;
      if (!dock) {
        return;
      }

      if (workspaceThemeDockOpen) {
        updateDockRect();
      }

      const inRevealZone = isPointerInWorkspaceThemeDockRevealZone({
        clientX: event.clientX,
        clientY: event.clientY,
        rect: workspaceThemeDockRectRef.current,
      });

      if (!workspaceThemeDockOpen) {
        if (inRevealZone) {
          clearWorkspaceThemeDockAutoHideTimer();
          setWorkspaceThemeDockOpen(true);
          setWorkspaceThemeDockPassThrough(false);
        }
        return;
      }

      if (!inRevealZone) {
        setWorkspaceThemeDockPassThrough(false);
        if (workspaceThemeDockAutoHideTimerRef.current === null) {
          scheduleWorkspaceThemeDockAutoHide();
        }
        return;
      }

      clearWorkspaceThemeDockAutoHideTimer();
      const shouldPassThrough = document
        .elementsFromPoint(event.clientX, event.clientY)
        .some((element) => isExternalInteractiveElement(element, dock));
      setWorkspaceThemeDockPassThrough(shouldPassThrough);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("resize", updateDockRect);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", updateDockRect);
    };
  }, [
    clearWorkspaceThemeDockAutoHideTimer,
    scheduleWorkspaceThemeDockAutoHide,
    shellScheme,
    workspaceThemeDockOpen,
  ]);

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
    if (desktopRightControlsRef.current) {
      observer.observe(desktopRightControlsRef.current);
    }
    updateDesktopNavLayout();
    return () => observer.disconnect();
  }, [updateDesktopNavLayout]);

  useEffect(() => {
    if (shellScheme !== "workspace" || typeof window === "undefined") {
      return;
    }

    const observedElements = [
      workspaceNavRef.current,
      workspaceMeasureRowRef.current,
      workspaceBrandRef.current,
      workspaceRuntimeRef.current,
      workspaceLocaleRef.current,
      workspaceProfileRef.current,
    ].filter((element): element is HTMLElement => Boolean(element));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateWorkspaceNavLayout);
    observedElements.forEach((element) => observer?.observe(element));
    window.addEventListener("resize", updateWorkspaceNavLayout);
    updateWorkspaceNavLayout();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWorkspaceNavLayout);
    };
  }, [shellScheme, updateWorkspaceNavLayout]);

  useEffect(() => {
    if (desktopOverflowNavItems.length === 0) {
      desktopMorePinnedRef.current = false;
      setDesktopMoreOpen(false);
    }
  }, [desktopOverflowNavItems.length]);

  useEffect(() => {
    if (shellScheme === "workspace" && workspaceMoreNavItems.length === 0) {
      setDesktopMoreOpen(false);
    }
  }, [shellScheme, workspaceMoreNavItems.length]);

  useEffect(() => {
    if (!desktopMoreOpen || typeof window === "undefined") {
      return;
    }

    const closeDesktopMoreInCompactMode = () => {
      const compactQuery = shellScheme === "workspace" ? "(max-width: 980px)" : "(max-width: 767.98px)";
      if (window.matchMedia(compactQuery).matches) {
        clearDesktopMoreCloseTimer();
        desktopMorePinnedRef.current = false;
        setDesktopMoreOpen(false);
      }
    };

    closeDesktopMoreInCompactMode();
    window.addEventListener("resize", closeDesktopMoreInCompactMode);
    return () => window.removeEventListener("resize", closeDesktopMoreInCompactMode);
  }, [clearDesktopMoreCloseTimer, desktopMoreOpen, shellScheme]);

  useEffect(() => {
    if (!mobileMoreOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (mobileMorePanelRef.current?.contains(target) || mobileMoreButtonRef.current?.contains(target)) {
        return;
      }
      setMobileMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMoreOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [mobileMoreOpen]);

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
        label={t("nav.layoutScheme")}
        currentLabel={t(UI_LAYOUT_SCHEME_METADATA.find((scheme) => scheme.id === activeScheme)?.labelKey ?? "layout.scheme.classic.label")}
        options={layoutSchemeOptions}
        value={activeScheme}
        onChange={handleLayoutSchemeChange}
        triggerIcon={LayoutDashboard}
      />
      <PreferenceMenu
        label={t("nav.theme")}
        currentLabel={activeThemeLabel}
        options={activeThemeOptions}
        value={activeThemeValue}
        onChange={handleThemeControlChange}
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

  const renderMobileMenuItems = (itemClassName: (active: boolean) => string) =>
    visibleNavItems.map((item) => {
      const Icon = item.icon;
      const active = item.match(location.pathname);
      const label = t(item.labelKey);
      return (
        <Link
          key={item.to}
          to={item.to}
          role="menuitem"
          aria-current={active ? "page" : undefined}
          className={itemClassName(active)}
          onClick={() => setMobileMoreOpen(false)}
        >
          <Icon size={17} aria-hidden="true" />
          <span className="min-w-0 truncate">{label}</span>
        </Link>
      );
    });

  const renderWorkspaceNavItem = (item: TopNavItem) => {
    const active = isWorkspaceNavItemActive(item, location.pathname);
    const label = t(item.labelKey);
    return (
      <Link
        key={item.to}
        to={workspaceTopNavTarget(item)}
        aria-current={active ? "page" : undefined}
        className="pf-shell-concept-link"
      >
        {label}
      </Link>
    );
  };

  const renderWorkspaceNavMeasurementItem = (item: TopNavItem) => {
    const label = t(item.labelKey);
    return (
      <span
        key={item.to}
        ref={(node) => {
          workspaceMeasureItemRefs.current[item.to] = node;
        }}
        className="pf-shell-concept-link"
      >
        {label}
      </span>
    );
  };

  const renderWorkspaceMoreItem = (item: TopNavItem) => {
    const active = isWorkspaceNavItemActive(item, location.pathname);
    const label = t(item.labelKey);
    return (
      <Link
        key={item.to}
        to={workspaceTopNavTarget(item)}
        role="menuitem"
        aria-current={active ? "page" : undefined}
        className="pf-shell-more-item"
        onClick={() => {
          clearDesktopMoreCloseTimer();
          setDesktopMoreOpen(false);
        }}
      >
        <span>{label}</span>
        <ArrowUpRight size={14} aria-hidden="true" />
      </Link>
    );
  };

  const renderWorkspaceCompactLink = (item: TopNavItem, className: string) => {
    const active = isWorkspaceNavItemActive(item, location.pathname);
    const label = t(item.labelKey);
    return (
      <Link
        key={item.to}
        to={workspaceTopNavTarget(item)}
        aria-current={active ? "page" : undefined}
        className={className}
        onClick={() => setMobileMoreOpen(false)}
      >
        {label}
      </Link>
    );
  };

  const renderWorkspaceThemeDock = () => {
    const interactive = workspaceThemeDockOpen && !workspaceThemeDockPassThrough;
    return (
      <div
        ref={workspaceThemeDockRef}
        aria-hidden={!workspaceThemeDockOpen}
        aria-label={t("nav.theme")}
        className={[
          "pf-shell-theme-dock",
          workspaceThemeDockOpen ? "is-open" : "is-collapsed",
          workspaceThemeDockPassThrough ? "is-pass-through" : "",
        ].filter(Boolean).join(" ")}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            scheduleWorkspaceThemeDockAutoHide();
          }
        }}
        onFocusCapture={keepWorkspaceThemeDockOpen}
        onPointerEnter={keepWorkspaceThemeDockOpen}
        onPointerLeave={scheduleWorkspaceThemeDockAutoHide}
      >
        {WORKSPACE_APPEARANCE_METADATA.map((appearance) => {
          const active = appearance.id === workspaceAppearance;
          return (
            <button
              key={appearance.id}
              type="button"
              aria-pressed={active}
              className="pf-shell-theme-option"
              disabled={!interactive}
              style={{ "--pf-shell-theme-swatch": appearance.swatch } as CSSProperties}
              tabIndex={interactive ? undefined : -1}
              onClick={() => {
                handleThemeControlChange(appearance.id);
                scheduleWorkspaceThemeDockAutoHide();
              }}
            >
              {t(appearance.labelKey)}
            </button>
          );
        })}
      </div>
    );
  };

  const renderWorkspaceBrandChip = (containerRef?: Ref<HTMLDivElement>) => (
    <div ref={containerRef} className="pf-shell-brand-chip">
      <WeatherControl />
      <Link to={WORKSPACE_HOME_PATH} aria-label="Inspiration One">
        <span>
          Inspiration One
          <small>{workspaceBrandWeatherSummary}</small>
        </span>
      </Link>
    </div>
  );

  if (shellScheme === "workspace") {
    return (
      <>
        <div
          data-ui-layout-scheme="workspace"
          className={`pf-shell-workspace-shell ${curtainOpen ? "is-open" : "is-collapsed"}`}
          style={{ transitionTimingFunction: CURTAIN_EASING }}
          onPointerDown={keepCurtainOpen}
          onFocusCapture={keepCurtainOpen}
          onKeyDownCapture={keepCurtainOpen}
        >
          <div className="pf-shell-compact-brand-mark">{renderWorkspaceBrandChip(workspaceBrandRef)}</div>
          <nav
            ref={workspaceNavRef}
            aria-hidden={!curtainOpen}
            className="pf-shell-concept-nav"
            aria-label={t("nav.mobile")}
            style={{ transitionTimingFunction: CURTAIN_EASING }}
          >
            <div ref={workspaceRuntimeRef} className="pf-shell-runtime-switch" aria-label={t("nav.layoutScheme")}>
              {layoutSchemeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={option.value === activeScheme}
                  className="pf-shell-runtime-option"
                  onClick={() => handleLayoutSchemeChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {workspaceVisiblePrimaryNavItems.map((item) => renderWorkspaceNavItem(item))}

            {workspaceMoreNavItems.length ? (
              <div
                className="pf-shell-nav-more"
                onPointerEnter={() => {
                  clearDesktopMoreCloseTimer();
                  keepCurtainOpen();
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
                  ref={desktopMoreButtonRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={desktopMoreOpen}
                  className="pf-shell-concept-link pf-shell-nav-more-button"
                  onClick={() => {
                    clearDesktopMoreCloseTimer();
                    keepCurtainOpen();
                    setDesktopMoreOpen((current) => !current);
                  }}
                >
                  {t("nav.more")}
                </button>
                <FloatingSurface
                  open={desktopMoreOpen}
                  triggerRef={desktopMoreButtonRef}
                  preferredPlacement="bottom-end"
                  layer="modal"
                  matchTriggerWidth={false}
                  minWidth={218}
                  offset={12}
                  margin={12}
                  onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                      clearDesktopMoreCloseTimer();
                    }
                    setDesktopMoreOpen(nextOpen);
                  }}
                  className="pf-shell-more-panel"
                >
                  <div
                    role="menu"
                    aria-label={t("nav.more")}
                    onPointerEnter={clearDesktopMoreCloseTimer}
                    onPointerLeave={scheduleDesktopMoreClose}
                  >
                    {workspaceMoreNavItems.map((item) => renderWorkspaceMoreItem(item))}
                  </div>
                </FloatingSurface>
              </div>
            ) : null}

            <div ref={workspaceLocaleRef} className="pf-shell-locale-switch" aria-label={t("nav.language")}>
              {localeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={option.value === locale}
                  className="pf-shell-locale-option"
                  title={option.label}
                  onClick={() => setLocale(option.value)}
                >
                  {workspaceLocaleMarkers[option.value]}
                </button>
              ))}
            </div>

            {logoutAction ? <WorkspaceAccountMenu containerRef={workspaceProfileRef} identity={account} onLogout={logoutAction} /> : null}
            <div ref={workspaceMeasureRowRef} aria-hidden="true" className="pf-shell-workspace-measure-row">
              {visibleNavItems.map((item) => renderWorkspaceNavMeasurementItem(item))}
              <span ref={workspaceMoreMeasureRef} className="pf-shell-concept-link pf-shell-nav-more-button">
                {t("nav.more")}
              </span>
            </div>
          </nav>
          <button
            type="button"
            aria-label={t("nav.more")}
            aria-expanded={curtainOpen}
            className="pf-shell-workspace-handle"
            style={{ transitionTimingFunction: CURTAIN_EASING }}
            onClick={keepCurtainOpen}
          >
            <ChevronDown size={17} aria-hidden="true" />
          </button>
        </div>

        {renderWorkspaceThemeDock()}

        <div className="pf-shell-compact-action-dock" aria-label={t("nav.mobile")}>
          <button
            ref={mobileMoreButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={mobileMoreOpen}
            className="pf-shell-action-ball"
            onClick={() => {
              clearDesktopMoreCloseTimer();
              setDesktopMoreOpen(false);
              setMobileMoreOpen((current) => !current);
            }}
          >
            {workspaceActionLabel(locale)}
          </button>

          {mobileMoreOpen ? (
            <div ref={mobileMorePanelRef} className="pf-shell-compact-action-panel" role="menu" aria-label={t("nav.mobile")}>
              <div className="pf-shell-compact-quick-row" aria-label={t("nav.mobile")}>
                {primaryNavItems
                  .filter((item) => item.labelKey !== "nav.settings")
                  .map((item, index) =>
                    renderWorkspaceCompactLink(
                      item,
                      index < 3 ? "pf-shell-compact-quick primary" : "pf-shell-compact-quick",
                    ),
                  )}
              </div>

              <div className="pf-shell-compact-more-row" aria-label={t("nav.more")}>
                {workspaceMoreNavItems.map((item) => renderWorkspaceCompactLink(item, "pf-shell-compact-secondary"))}
                {primaryNavItems
                  .filter((item) => item.labelKey === "nav.settings")
                  .map((item) => renderWorkspaceCompactLink(item, "pf-shell-compact-secondary"))}
              </div>

              {logoutAction ? (
                <div className="pf-shell-compact-profile-row" aria-label={account.displayName}>
                  <div className="pf-shell-compact-profile-summary">
                    <strong>{account.displayName}</strong>
                    {account.username ? <small>{account.username}</small> : null}
                  </div>
                  <button
                    type="button"
                    className="pf-shell-compact-profile-logout"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      logoutAction();
                    }}
                  >
                    <LogOut size={14} aria-hidden="true" />
                    {t("nav.logout")}
                  </button>
                </div>
              ) : null}

              <div className="pf-shell-compact-system-row" aria-label={t("nav.layoutScheme")}>
                <div className="pf-shell-compact-control-block">
                  <span className="pf-shell-compact-control-label">{t("nav.language")}</span>
                  <div className="pf-shell-compact-system-group" aria-label={t("nav.language")}>
                    {localeOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={option.value === locale}
                        className="pf-shell-compact-system pf-shell-compact-layout-option"
                        onClick={() => setLocale(option.value)}
                      >
                        {workspaceLocaleMarkers[option.value]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pf-shell-compact-control-block">
                  <span className="pf-shell-compact-control-label">{t("nav.layoutScheme")}</span>
                  <div className="pf-shell-compact-layout-switch" aria-label={t("nav.layoutScheme")}>
                    {layoutSchemeOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={option.value === activeScheme}
                        className="pf-shell-compact-system pf-shell-compact-layout-option"
                        onClick={() => handleLayoutSchemeChange(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pf-shell-compact-control-block">
                  <span className="pf-shell-compact-control-label">{t("nav.theme")}</span>
                  <div className="pf-shell-compact-system-group" aria-label={t("nav.theme")}>
                    {workspaceAppearanceOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={option.value === workspaceAppearance}
                        className="pf-shell-compact-system pf-shell-compact-layout-option"
                        onClick={() => handleThemeControlChange(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <div
        ref={curtainRef}
        data-ui-layout-scheme={shellScheme}
        className={curtainShellClassName(curtainOpen)}
        style={{ transitionTimingFunction: CURTAIN_EASING }}
        onPointerDown={keepCurtainOpen}
        onFocusCapture={keepCurtainOpen}
        onKeyDownCapture={keepCurtainOpen}
      >
        <nav
          aria-hidden={!curtainOpen}
          className={curtainPanelClassName(curtainOpen)}
          style={{ transitionTimingFunction: CURTAIN_EASING }}
        >
          <div className="relative mx-auto flex w-full max-w-[1500px] items-center md:gap-3">
            <div aria-hidden="true" className="hidden w-52 shrink-0 md:block lg:w-56" />
            <div
              ref={desktopNavAreaRef}
              className="hidden min-w-0 flex-1 overflow-hidden justify-center md:flex"
            >
              <div className="pf-shell-nav-frame relative flex max-w-full min-w-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1 shadow-inner shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-none">
                <div className="flex min-w-0 items-center gap-1">
                  {desktopVisibleNavItems.map((item) => renderDesktopNavItem(item))}
                  {desktopOverflowNavItems.length ? (
                    <div
                      className="relative"
                      onPointerEnter={() => {
                        clearDesktopMoreCloseTimer();
                        keepCurtainOpen();
                        setDesktopMoreOpen(true);
                      }}
                      onPointerLeave={scheduleDesktopMoreClose}
                      onBlur={(event) => {
                        const nextTarget = event.relatedTarget;
                        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                          clearDesktopMoreCloseTimer();
                          desktopMorePinnedRef.current = false;
                          setDesktopMoreOpen(false);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          clearDesktopMoreCloseTimer();
                          desktopMorePinnedRef.current = false;
                          setDesktopMoreOpen(false);
                        }
                      }}
                    >
                      <button
                        ref={desktopMoreButtonRef}
                        type="button"
                        aria-label={t("nav.more")}
                        aria-haspopup="menu"
                        aria-expanded={desktopMoreOpen}
                        className={navItemClassName(desktopOverflowActive || desktopMoreOpen)}
                        onClick={() => {
                          clearDesktopMoreCloseTimer();
                          keepCurtainOpen();
                          setDesktopMoreOpen((current) => {
                            if (current && desktopMorePinnedRef.current) {
                              desktopMorePinnedRef.current = false;
                              return false;
                            }
                            desktopMorePinnedRef.current = true;
                            return true;
                          });
                        }}
                      >
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </button>
                      <FloatingSurface
                        open={desktopMoreOpen}
                        triggerRef={desktopMoreButtonRef}
                        preferredPlacement="bottom-end"
                        layer="modal"
                        matchTriggerWidth={false}
                        onOpenChange={(nextOpen) => {
                          if (!nextOpen) {
                            clearDesktopMoreCloseTimer();
                            desktopMorePinnedRef.current = false;
                          }
                          setDesktopMoreOpen(nextOpen);
                        }}
                        className={desktopMoreMenuClassName()}
                      >
                      <div
                        role="menu"
                        aria-label={t("nav.more")}
                        onPointerEnter={clearDesktopMoreCloseTimer}
                        onPointerLeave={scheduleDesktopMoreClose}
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
                                desktopMorePinnedRef.current = false;
                                setDesktopMoreOpen(false);
                              }}
                            >
                              <Icon size={16} aria-hidden="true" />
                              <span className="truncate">{label}</span>
                            </Link>
                          );
                        })}
                      </div>
                      </FloatingSurface>
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

            <div
              ref={desktopRightControlsRef}
              className="hidden w-52 shrink-0 items-center justify-end gap-1.5 md:flex lg:w-56"
            >
              {renderPreferenceControls()}
              {logoutAction ? <AccountMenu identity={account} onLogout={logoutAction} /> : null}
            </div>
          </div>
        </nav>
        <button
          type="button"
          aria-label={t("nav.more")}
          aria-expanded={curtainOpen}
          className={curtainHandleClassName(curtainOpen)}
          style={{ transitionTimingFunction: CURTAIN_EASING }}
          onClick={keepCurtainOpen}
        >
          <ChevronDown size={17} aria-hidden="true" />
        </button>
      </div>

      {mobileMoreOpen && shellScheme === "classic" ? (
        <div
          ref={mobileMorePanelRef}
          className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-50 max-h-[calc(100dvh-9rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-950/15 dark:border-slate-700 dark:bg-[#111827] dark:shadow-black/40 md:hidden"
        >
          <div className="grid gap-1">
            {logoutAction ? (
              <div className="pf-shell-account-summary mb-1 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900">
                <div className="pf-shell-value truncate text-sm font-semibold text-slate-950 dark:text-white">
                  {account.displayName}
                </div>
                {account.username ? (
                  <div className="pf-shell-muted mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{account.username}</div>
                ) : null}
              </div>
            ) : null}
            {renderMobileMenuItems(mobileMoreMenuItemClassName)}
            <MobilePreferenceGroup label={t("nav.language")} options={localeOptions} value={locale} onChange={setLocale} />
            <MobilePreferenceGroup
              label={t("nav.layoutScheme")}
              options={layoutSchemeOptions}
              value={activeScheme}
              onChange={handleLayoutSchemeChange}
            />
            <MobilePreferenceGroup
              label={t("nav.theme")}
              options={activeThemeOptions}
              value={activeThemeValue}
              onChange={handleThemeControlChange}
            />
            {logoutAction ? (
              <button
                type="button"
                onClick={() => {
                  setMobileMoreOpen(false);
                  logoutAction();
                }}
                className={mobileMoreMenuItemClassName(false)}
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
        data-ui-layout-scheme={shellScheme}
        className={mobileBottomNavClassName(curtainOpen)}
        style={{ transitionTimingFunction: CURTAIN_EASING }}
        onPointerDown={keepCurtainOpen}
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
              ref={mobileMoreButtonRef}
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
