// 设置页左侧导航栏：桌面侧栏 + 小窗左侧浮动抽屉。从 SettingsPage.tsx 抽出的展示型组件。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Drawer } from "vaul";
import { Search, Settings as SettingsIcon, X } from "lucide-react";

import { ClassicTextInput } from "../../../components/classicInputs";
import { WorkspaceTextInput } from "../../../components/workspaceInputs";
import { cssLengthToPixels } from "../../../lib/cssLength";
import { shouldPreventScrollChain } from "../../../lib/scrollChain";
import { useI18n } from "../../../lib/preferences";
import { useSettingsActionClassNames } from "./styles";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionId } from "../sections";

interface SettingsSideRailProps {
  search: string;
  onSearchChange: (value: string) => void;
  visibleSections: SettingsSection[];
  activeSection: SettingsSectionId;
  workspaceSubpage?: boolean;
  onSectionChange: (section: SettingsSectionId) => void;
}

const SETTINGS_MOBILE_NAV_DRAWER_DESKTOP_QUERY = "(min-width: 1024px)";

function shouldUseDesktopSettingsRail(): boolean {
  return typeof window !== "undefined" && window.matchMedia(SETTINGS_MOBILE_NAV_DRAWER_DESKTOP_QUERY).matches;
}

interface CenteredRailScrollTopInput {
  containerHeight: number;
  contentHeight: number;
  itemTop: number;
  itemHeight: number;
}

export function centeredRailScrollTop({
  containerHeight,
  contentHeight,
  itemTop,
  itemHeight,
}: CenteredRailScrollTopInput): number {
  const maxScrollTop = Math.max(contentHeight - containerHeight, 0);
  const centeredTop = itemTop + itemHeight / 2 - containerHeight / 2;
  return Math.min(Math.max(centeredTop, 0), maxScrollTop);
}

interface RailVisibleWindowInput {
  containerTop: number;
  containerBottom: number;
  safeTop: number;
  viewportHeight: number;
}

interface RailVisibleWindow {
  top: number;
  bottom: number;
  height: number;
}

export function railVisibleWindow({
  containerTop,
  containerBottom,
  safeTop,
  viewportHeight,
}: RailVisibleWindowInput): RailVisibleWindow {
  const top = Math.max(safeTop - containerTop, 0);
  const bottom = Math.max(Math.min(containerBottom, viewportHeight) - containerTop, top);
  return { top, bottom, height: bottom - top };
}

interface ShouldRestoreDesktopRailOnReloadInput {
  navigationType: string | null;
  contentHeight: number;
  visibleTop: number;
  visibleBottom: number;
  itemTop: number;
  itemHeight: number;
}

export function shouldRestoreDesktopRailOnReload({
  navigationType,
  contentHeight,
  visibleTop,
  visibleBottom,
  itemTop,
  itemHeight,
}: ShouldRestoreDesktopRailOnReloadInput): boolean {
  if (navigationType !== "reload") {
    return false;
  }
  const visibleHeight = Math.max(visibleBottom - visibleTop, 0);
  if (visibleHeight <= 0 || contentHeight <= visibleHeight + 1) {
    return false;
  }
  const itemBottom = itemTop + itemHeight;
  return itemTop < visibleTop || itemBottom > visibleBottom;
}

function readNavigationEntryType(): string | null {
  if (typeof window === "undefined" || typeof window.performance === "undefined") {
    return null;
  }
  const entries =
    typeof window.performance.getEntriesByType === "function"
      ? (window.performance.getEntriesByType("navigation") as PerformanceNavigationTiming[])
      : [];
  const [entry] = entries;
  if (entry && typeof entry.type === "string") {
    return entry.type;
  }
  const legacyNavigation = (window.performance as Performance & { navigation?: { type?: number } }).navigation;
  return legacyNavigation?.type === 1 ? "reload" : null;
}

export function SettingsSideRail({
  search,
  onSearchChange,
  visibleSections,
  activeSection,
  workspaceSubpage = false,
  onSectionChange,
}: SettingsSideRailProps) {
  const { t } = useI18n();
  const { SETTINGS_SQUARE_ACTION_CLASS } = useSettingsActionClassNames();
  const railRef = useRef<HTMLElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const mobileScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const mobileDrawerButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingRailScrollFrameRef = useRef(0);
  const resetScrollFrameRef = useRef(0);
  const resetScrollTailFrameRef = useRef(0);
  const initialNavigationTypeRef = useRef<string | null>(readNavigationEntryType());
  const pendingInitialDesktopRestoreRef = useRef(initialNavigationTypeRef.current === "reload");
  const [isPinned, setIsPinned] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [useFloatingRail, setUseFloatingRail] = useState(() => !shouldUseDesktopSettingsRail());
  const [forceScrollableDesktopRail, setForceScrollableDesktopRail] = useState(false);
  const visibleSectionIdsKey = visibleSections.map((section) => section.id).join("|");

  const activeMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];

  function getSafeTop(): number {
    const rootStyle = window.getComputedStyle(document.documentElement);
    const rootFontSize = Number.parseFloat(rootStyle.fontSize) || 16;
    return cssLengthToPixels(rootStyle.getPropertyValue("--pf-top-chrome-safe-height"), rootFontSize);
  }

  function shouldPinRail(rail: HTMLElement): boolean {
    const shell = rail.parentElement;
    if (!shell) {
      return false;
    }
    const shellTopInDocument = shell.getBoundingClientRect().top + window.scrollY;
    return window.scrollY >= shellTopInDocument - getSafeTop() - 1;
  }

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const mediaQuery = window.matchMedia(SETTINGS_MOBILE_NAV_DRAWER_DESKTOP_QUERY);
    const handleViewportChange = (event?: MediaQueryListEvent) => {
      const useDesktopRail = event?.matches ?? mediaQuery.matches;
      setUseFloatingRail(!useDesktopRail);
      if (useDesktopRail) {
        setMobileDrawerOpen(false);
        setIsPinned(false);
      }
    };
    handleViewportChange();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleViewportChange);
      return () => mediaQuery.removeEventListener("change", handleViewportChange);
    }
    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }
    let frameId = 0;
    const rail = railRef.current;
    const shell = rail?.parentElement;
    if (useFloatingRail || !rail || !shell) {
      return undefined;
    }
    const updatePinnedState = () => {
      frameId = 0;
      const currentRail = railRef.current;
      if (!currentRail) {
        return;
      }
      const nextPinned = shouldPinRail(currentRail);
      setIsPinned((currentPinned) => (currentPinned === nextPinned ? currentPinned : nextPinned));
    };
    const schedulePinnedStateUpdate = () => {
      if (frameId) {
        return;
      }
      frameId = window.requestAnimationFrame(updatePinnedState);
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            schedulePinnedStateUpdate();
          });
    resizeObserver?.observe(rail);
    resizeObserver?.observe(shell);
    schedulePinnedStateUpdate();
    window.addEventListener("scroll", schedulePinnedStateUpdate, { passive: true });
    window.addEventListener("resize", schedulePinnedStateUpdate);
    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", schedulePinnedStateUpdate);
      window.removeEventListener("resize", schedulePinnedStateUpdate);
    };
  }, [useFloatingRail]);

  useEffect(() => {
    if (useFloatingRail) {
      setForceScrollableDesktopRail(false);
      return undefined;
    }
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea || isPinned || forceScrollableDesktopRail) {
      return;
    }
    window.cancelAnimationFrame(pendingRailScrollFrameRef.current);
    window.cancelAnimationFrame(resetScrollFrameRef.current);
    window.cancelAnimationFrame(resetScrollTailFrameRef.current);
    scrollArea.scrollTop = 0;
    resetScrollFrameRef.current = window.requestAnimationFrame(() => {
      const currentScrollArea = scrollAreaRef.current;
      if (!currentScrollArea) {
        return;
      }
      currentScrollArea.scrollTop = 0;
      resetScrollTailFrameRef.current = window.requestAnimationFrame(() => {
        scrollAreaRef.current?.scrollTo({ top: 0 });
      });
    });
    return () => {
      window.cancelAnimationFrame(resetScrollFrameRef.current);
      window.cancelAnimationFrame(resetScrollTailFrameRef.current);
    };
  }, [forceScrollableDesktopRail, isPinned, useFloatingRail]);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || useFloatingRail) {
      return;
    }
    if (!pendingInitialDesktopRestoreRef.current) {
      return;
    }
    const scrollArea = scrollAreaRef.current;
    const activeItem = activeItemRef.current;
    if (!scrollArea || !activeItem) {
      setForceScrollableDesktopRail(false);
      pendingInitialDesktopRestoreRef.current = false;
      return;
    }
    const scrollAreaRect = scrollArea.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const visibleWindow = railVisibleWindow({
      containerTop: scrollAreaRect.top,
      containerBottom: scrollAreaRect.bottom,
      safeTop: getSafeTop(),
      viewportHeight: window.innerHeight,
    });
    const shouldRestore = shouldRestoreDesktopRailOnReload({
      navigationType: initialNavigationTypeRef.current,
      contentHeight: scrollArea.scrollHeight,
      visibleTop: visibleWindow.top,
      visibleBottom: visibleWindow.bottom,
      itemTop: itemRect.top - scrollAreaRect.top,
      itemHeight: itemRect.height,
    });
    setForceScrollableDesktopRail(shouldRestore);
    if (!shouldRestore) {
      pendingInitialDesktopRestoreRef.current = false;
    }
  }, [useFloatingRail, visibleSectionIdsKey]);

  useEffect(() => {
    if (useFloatingRail) {
      return undefined;
    }
    const rail = railRef.current;
    if (!rail || typeof window === "undefined") {
      return undefined;
    }
    const handleWheel = (event: WheelEvent) => {
      const scrollArea = scrollAreaRef.current;
      if (!scrollArea) {
        return;
      }
      const shellTop = rail.parentElement?.getBoundingClientRect().top ?? 0;
      const safeTop = getSafeTop();
      const distanceToPin = Math.max(shellTop - safeTop, 0);
      const pinnedScrollableHeight = Math.max(window.innerHeight - safeTop, 0);
      const railCanScrollWhenPinned = scrollArea.scrollHeight > pinnedScrollableHeight + 1;
      const railCanScrollNow =
        scrollArea.scrollHeight > scrollArea.clientHeight + 1 ||
        scrollArea.scrollWidth > scrollArea.clientWidth + 1;

      if (!isPinned && !forceScrollableDesktopRail) {
        if (!railCanScrollWhenPinned || event.deltaY === 0) {
          return;
        }
        event.preventDefault();
        if (event.deltaY < 0) {
          window.scrollBy({ top: event.deltaY, behavior: "auto" });
          return;
        }

        const pageDelta = Math.min(event.deltaY, distanceToPin);
        if (pageDelta !== 0) {
          window.scrollBy({ top: pageDelta, behavior: "auto" });
        }

        const reachedPinnedThreshold = distanceToPin - pageDelta <= 1;
        if (!reachedPinnedThreshold) {
          return;
        }

        setIsPinned(true);
        const remainingDelta = Math.max(event.deltaY - pageDelta, 0);
        if (remainingDelta > 0) {
          window.cancelAnimationFrame(pendingRailScrollFrameRef.current);
          pendingRailScrollFrameRef.current = window.requestAnimationFrame(() => {
            const currentRail = railRef.current;
            const currentScrollArea = scrollAreaRef.current;
            if (!currentRail || !currentScrollArea || !shouldPinRail(currentRail)) {
              return;
            }
            currentScrollArea.scrollTop += remainingDelta;
          });
        }
        return;
      }

      if (!railCanScrollNow) {
        return;
      }

      if (shouldPreventScrollChain(scrollArea, event.target, event.deltaX, event.deltaY)) {
        event.preventDefault();
      }
    };
    rail.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => {
      window.cancelAnimationFrame(pendingRailScrollFrameRef.current);
      rail.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [forceScrollableDesktopRail, isPinned, useFloatingRail]);

  useLayoutEffect(() => {
    const shouldRestoreMobileRail = useFloatingRail && mobileDrawerOpen;
    const shouldRestoreDesktopRail = !useFloatingRail && pendingInitialDesktopRestoreRef.current && forceScrollableDesktopRail;
    const activeItem = activeItemRef.current;
    if (!activeItem) {
      return;
    }
    const scrollContainer = shouldRestoreMobileRail
      ? mobileScrollAreaRef.current
      : shouldRestoreDesktopRail
        ? scrollAreaRef.current
        : null;
    if (!scrollContainer) {
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    const itemTop = itemRect.top - containerRect.top + scrollContainer.scrollTop;
    const nextScrollTop = centeredRailScrollTop({
      containerHeight: scrollContainer.clientHeight,
      contentHeight: scrollContainer.scrollHeight,
      itemTop,
      itemHeight: itemRect.height,
    });
    scrollContainer.scrollTo({ top: nextScrollTop, behavior: "auto" });
    if (shouldRestoreDesktopRail) {
      pendingInitialDesktopRestoreRef.current = false;
    }
  }, [
    activeSection,
    forceScrollableDesktopRail,
    mobileDrawerOpen,
    useFloatingRail,
    visibleSectionIdsKey,
  ]);

  function focusMobileDrawerTrigger() {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      mobileDrawerButtonRef.current?.focus();
    });
  }

  function handleSectionSelect(section: SettingsSectionId) {
    onSectionChange(section);
    if (useFloatingRail) {
      setMobileDrawerOpen(false);
    }
  }

  const searchField = (
    workspaceSubpage ? (
      <label htmlFor="settings-section-search" className="relative mt-6 block">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
        />
        <WorkspaceTextInput
          id="settings-section-search"
          name="settings_section_search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("settings.searchPlaceholder")}
          size="default"
          className="pl-10"
        />
      </label>
    ) : (
      <label htmlFor="settings-section-search" className="relative mt-6 block">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
        />
        <ClassicTextInput
          id="settings-section-search"
          name="settings_section_search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("settings.searchPlaceholder")}
          size="default"
          className="pl-10"
        />
      </label>
    )
  );

  const railNavigation = (
    <nav className="space-y-8 px-3 py-5" aria-label={t("settings.navLabel")}>
      {SETTINGS_GROUPS.map((group) => {
        const sections = visibleSections.filter((section) => section.groupKey === group);
        if (!sections.length) {
          return null;
        }
        return (
          <div key={group}>
            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t(group)}
            </div>
            <div className="mt-2 space-y-2">
              {sections.map((section) => {
                const Icon = section.icon;
                const active = section.id === activeSection;
                return (
                  <button
                    key={section.id}
                    ref={active ? activeItemRef : null}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => handleSectionSelect(section.id)}
                    className={`pf-settings-nav-item flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                      active ? "font-semibold text-slate-950 dark:text-white" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    <Icon
                      size={15}
                      className={active ? "shrink-0" : "shrink-0 text-slate-400 dark:text-slate-500"}
                    />
                    <span className="truncate">{t(section.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  const railContent = (
    <>
      <div className="border-b pf-hairline px-5 py-7 dark:border-slate-700/40">
        <div className="flex items-center gap-3 text-lg font-semibold text-slate-950 dark:text-white">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-violet-500/15 dark:text-violet-200">
            <SettingsIcon size={20} />
          </span>
          {t("settings.title")}
        </div>
        {searchField}
      </div>
      {railNavigation}
    </>
  );

  const railStyle: CSSProperties = isPinned
    ? {
        position: "sticky",
        top: "var(--pf-top-chrome-safe-height)",
        height: "auto",
      }
    : {
        position: "static",
        top: "auto",
        height: "auto",
      };
  const scrollAreaStyle: CSSProperties = isPinned
    ? {
        maxHeight: "calc(100dvh - var(--pf-top-chrome-safe-height))",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
      }
    : forceScrollableDesktopRail
      ? {
          maxHeight: "calc(100dvh - var(--pf-top-chrome-safe-height))",
          overflowY: "auto",
          overscrollBehaviorY: "contain",
        }
      : {
        maxHeight: "none",
        overflow: "visible",
        overscrollBehavior: "auto",
      };

  return (
    <>
      {useFloatingRail ? (
        <button
          ref={mobileDrawerButtonRef}
          type="button"
          onClick={() => setMobileDrawerOpen(true)}
          className="pf-settings-mobile-nav-trigger"
          aria-label={`${t("settings.navLabel")} · ${t(activeMeta.labelKey)}`}
          title={`${t("settings.navLabel")} · ${t(activeMeta.labelKey)}`}
        >
          <span className="pf-settings-mobile-nav-mark" aria-hidden="true">
            <SettingsIcon size={18} />
          </span>
          <span className="text-center text-[11px] font-semibold leading-4">{t("settings.title")}</span>
        </button>
      ) : null}

      {!useFloatingRail ? (
        <aside
          ref={railRef}
          className={`pf-side-rail pf-settings-side-rail backdrop-blur-sm bg-white/60 dark:bg-[#0a1018]/60 ${
            isPinned ? "pf-settings-side-rail-pinned" : ""
          }`}
          data-settings-rail-pinned={isPinned ? "true" : "false"}
          style={railStyle}
        >
          <div key={isPinned ? "pinned" : "unpinned"} ref={scrollAreaRef} style={scrollAreaStyle}>
            {railContent}
          </div>
        </aside>
      ) : null}

      {useFloatingRail ? (
        <Drawer.Root
          direction="left"
          open={mobileDrawerOpen}
          onOpenChange={(open) => {
            setMobileDrawerOpen(open);
            if (!open) {
              focusMobileDrawerTrigger();
            }
          }}
        >
          <Drawer.Portal>
            <Drawer.Overlay
              className="fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[2px]"
              onWheel={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onTouchMove={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            />
            <Drawer.Content
              onClick={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
              onTouchMove={(event) => event.stopPropagation()}
              className="pf-settings-mobile-nav-drawer fixed inset-y-0 left-0 z-[71] flex w-[min(86vw,340px)] flex-col border-r outline-none"
            >
              <Drawer.Title className="sr-only">{t("settings.navLabel")}</Drawer.Title>
              <div className="pf-settings-mobile-nav-drawer-header px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="pf-settings-mobile-nav-mark shrink-0" aria-hidden="true">
                      <SettingsIcon size={18} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950 dark:text-white">{t("settings.title")}</div>
                      <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{t(activeMeta.labelKey)}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t("common.close")}
                    title={t("common.close")}
                    onClick={() => setMobileDrawerOpen(false)}
                    className={`${SETTINGS_SQUARE_ACTION_CLASS} shrink-0`}
                  >
                    <X size={18} />
                  </button>
                </div>
                {searchField}
              </div>
              <div
                ref={mobileScrollAreaRef}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+1rem)]"
              >
                {railNavigation}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      ) : null}
    </>
  );
}
