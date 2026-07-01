// 设置页左侧导航栏：桌面侧栏 + 小窗左侧浮动抽屉。从 SettingsPage.tsx 抽出的展示型组件。
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Drawer } from "vaul";
import { Search, Settings as SettingsIcon, X } from "lucide-react";

import { cssLengthToPixels } from "../../../lib/cssLength";
import { shouldPreventScrollChain } from "../../../lib/scrollChain";
import { useI18n } from "../../../lib/preferences";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionId } from "../sections";

interface SettingsSideRailProps {
  search: string;
  onSearchChange: (value: string) => void;
  visibleSections: SettingsSection[];
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
}

const SETTINGS_MOBILE_NAV_DRAWER_DESKTOP_QUERY = "(min-width: 1024px)";

function shouldUseDesktopSettingsRail(): boolean {
  return typeof window !== "undefined" && window.matchMedia(SETTINGS_MOBILE_NAV_DRAWER_DESKTOP_QUERY).matches;
}

export function SettingsSideRail({
  search,
  onSearchChange,
  visibleSections,
  activeSection,
  onSectionChange,
}: SettingsSideRailProps) {
  const { t } = useI18n();
  const railRef = useRef<HTMLElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const mobileDrawerButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingRailScrollFrameRef = useRef(0);
  const resetScrollFrameRef = useRef(0);
  const resetScrollTailFrameRef = useRef(0);
  const [isPinned, setIsPinned] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [useFloatingRail, setUseFloatingRail] = useState(() => !shouldUseDesktopSettingsRail());

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
      return undefined;
    }
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea || isPinned) {
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
  }, [isPinned, useFloatingRail]);

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

      if (!isPinned) {
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
  }, [isPinned, useFloatingRail]);

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
    <label
      htmlFor="settings-section-search"
      className="pf-settings-search-shell mt-6 flex h-10 items-center gap-2 rounded-lg border pf-hairline bg-slate-50/50 px-3 text-sm text-slate-400 shadow-sm shadow-slate-200/20 dark:border-slate-700/40 dark:bg-[#0b1220]/50 dark:text-slate-500 dark:shadow-black/10"
    >
      <Search size={16} />
      <input
        id="settings-section-search"
        name="settings_section_search"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={t("settings.searchPlaceholder")}
        className="pf-composite-input pf-settings-search-input min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-sm text-slate-900 shadow-none outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
    </label>
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
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => handleSectionSelect(section.id)}
                    className={`pf-settings-nav-item flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                      active
                        ? "font-semibold text-indigo-700 bg-[linear-gradient(90deg,rgba(99,102,241,0.22),rgba(99,102,241,0.03)_32%,rgba(99,102,241,0.03)_68%,rgba(99,102,241,0.22))] dark:text-violet-100 dark:bg-[linear-gradient(90deg,rgba(139,92,246,0.32),rgba(139,92,246,0.04)_32%,rgba(139,92,246,0.04)_68%,rgba(139,92,246,0.32))]"
                        : "text-slate-500 hover:text-slate-800 hover:bg-[linear-gradient(90deg,rgba(100,116,139,0.13),rgba(100,116,139,0.02)_32%,rgba(100,116,139,0.02)_68%,rgba(100,116,139,0.13))] dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-[linear-gradient(90deg,rgba(139,92,246,0.16),rgba(139,92,246,0.02)_32%,rgba(139,92,246,0.02)_68%,rgba(139,92,246,0.16))]"
                    }`}
                  >
                    <Icon
                      size={15}
                      className={active ? "shrink-0 text-indigo-600 dark:text-violet-200" : "shrink-0 text-slate-400 dark:text-slate-500"}
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
              onClick={(event) => event.stopPropagation()}
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
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white/85 text-slate-600 transition-colors active:scale-[0.98] hover:border-slate-300 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/75 dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:text-violet-100"
                  >
                    <X size={18} />
                  </button>
                </div>
                {searchField}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                {railNavigation}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      ) : null}
    </>
  );
}
