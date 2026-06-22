// 设置页左侧导航栏：分组区块按钮、搜索框、移动端下拉选择。从 SettingsPage.tsx 抽出的展示型组件。

import type { WheelEvent } from "react";
import { Search, Settings as SettingsIcon } from "lucide-react";

import { SelectField } from "../../../components/SelectField";
import { useI18n } from "../../../lib/preferences";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionId } from "../sections";

function handleSettingsSideRailWheel(event: WheelEvent<HTMLElement>) {
  if (event.deltaY === 0) {
    return;
  }
  const element = event.currentTarget;
  const scrollTop = element.scrollTop;
  const canScrollUp = scrollTop > 0;
  const canScrollDown = scrollTop + element.clientHeight < element.scrollHeight - 1;
  const shouldPassToPage = event.deltaY < 0 ? !canScrollUp : !canScrollDown;

  if (!shouldPassToPage) {
    return;
  }
  event.preventDefault();
  window.scrollBy({ top: event.deltaY });
}

interface SettingsSideRailProps {
  search: string;
  onSearchChange: (value: string) => void;
  visibleSections: SettingsSection[];
  activeSection: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
}

export function SettingsSideRail({
  search,
  onSearchChange,
  visibleSections,
  activeSection,
  onSectionChange,
}: SettingsSideRailProps) {
  const { t } = useI18n();
  return (
    <aside
      className="pf-side-rail backdrop-blur-sm bg-white/60 dark:bg-[#0a1018]/60"
      onWheel={handleSettingsSideRailWheel}
    >
      <div className="border-b pf-hairline px-5 py-7 dark:border-slate-700/40">
        <div className="flex items-center gap-3 text-lg font-semibold text-slate-950 dark:text-white">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-violet-500/15 dark:text-violet-200">
            <SettingsIcon size={20} />
          </span>
          {t("settings.title")}
        </div>
        <label
          htmlFor="settings-section-search"
          className="mt-6 flex h-10 items-center gap-2 rounded-lg border pf-hairline bg-slate-50/50 px-3 text-sm text-slate-400 shadow-sm shadow-slate-200/20 dark:border-slate-700/40 dark:bg-[#0b1220]/50 dark:text-slate-500 dark:shadow-black/10"
        >
          <Search size={16} />
          <input
            id="settings-section-search"
            name="settings_section_search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("settings.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </label>
      </div>
      <nav className="hidden space-y-8 px-3 py-5 lg:block" aria-label={t("settings.navLabel")}>
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
                      onClick={() => onSectionChange(section.id)}
                      className={`pf-settings-nav-item flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                        active
                          ? "font-semibold text-indigo-700 bg-[linear-gradient(90deg,rgba(99,102,241,0.22),rgba(99,102,241,0.03)_32%,rgba(99,102,241,0.03)_68%,rgba(99,102,241,0.22))] dark:text-violet-100 dark:bg-[linear-gradient(90deg,rgba(139,92,246,0.32),rgba(139,92,246,0.04)_32%,rgba(139,92,246,0.04)_68%,rgba(139,92,246,0.32))]"
                          : "text-slate-500 hover:text-slate-800 hover:bg-[linear-gradient(90deg,rgba(100,116,139,0.13),rgba(100,116,139,0.02)_32%,rgba(100,116,139,0.02)_68%,rgba(100,116,139,0.13))] dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-[linear-gradient(90deg,rgba(139,92,246,0.16),rgba(139,92,246,0.02)_32%,rgba(139,92,246,0.02)_68%,rgba(139,92,246,0.16))]"
                      }`}
                    >
                      <Icon size={15} className={active ? "shrink-0 text-indigo-600 dark:text-violet-200" : "shrink-0 text-slate-400 dark:text-slate-500"} />
                      <span className="truncate">{t(section.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="p-4 lg:hidden">
        <label htmlFor="settings-section" className="mb-2 block text-xs font-semibold text-slate-500 dark:text-slate-400">
          {t("settings.mobileSectionLabel")}
        </label>
        <SelectField
          id="settings-section"
          value={activeSection}
          groups={SETTINGS_GROUPS.map((group) => ({
            label: t(group),
            options: SETTINGS_SECTIONS.filter((section) => section.groupKey === group).map((section) => ({
              value: section.id,
              label: t(section.labelKey),
            })),
          }))}
          onChange={(value) => onSectionChange(value as SettingsSectionId)}
          radius="lg"
        />
      </div>
    </aside>
  );
}
