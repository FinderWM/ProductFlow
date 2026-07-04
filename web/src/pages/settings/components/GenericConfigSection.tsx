// 设置页通用配置区块：提示词/上传/队列/界面外观/安全 五类运行时配置项的表单渲染
// （队列按分类分组、上传用卡片布局、其余为默认列表三种布局）。从 SettingsPage.tsx 抽出的展示型组件。

import type { FormEvent } from "react";
import { Loader2, Save } from "lucide-react";

import { useI18n } from "../../../lib/preferences";
import type { ConfigItem } from "../../../lib/types";
import { draftFromItem } from "../configDrafts";
import type { ConfigCategoryGroup, SettingsSectionId } from "../sections";
import type { DraftValue } from "../types";
import { ConfigField } from "./ConfigField";
import {
  PANEL_CLASS,
  SETTINGS_BORDERED_MODULE_CLASS,
  useSettingsActionClassNames,
} from "./styles";

interface GenericConfigSectionProps {
  activeSection: SettingsSectionId;
  items: ConfigItem[];
  configGroups: ConfigCategoryGroup[];
  drafts: Record<string, DraftValue>;
  secretTouched: Record<string, boolean>;
  resettingKey: string | null;
  disabled: boolean;
  saving: boolean;
  workspaceSubpage?: boolean;
  onChange: (item: ConfigItem, nextValue: DraftValue, touchedSecret?: boolean) => void;
  onReset: (item: ConfigItem) => void;
  onDiscard: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function GenericConfigSection({
  activeSection,
  items,
  configGroups,
  drafts,
  secretTouched,
  resettingKey,
  disabled,
  saving,
  workspaceSubpage = false,
  onChange,
  onReset,
  onDiscard,
  onSubmit,
}: GenericConfigSectionProps) {
  const { t } = useI18n();
  const { SETTINGS_COMPACT_ACTION_CLASS, SETTINGS_MAIN_ACTION_CLASS } = useSettingsActionClassNames();
  return (
    <form onSubmit={onSubmit} className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS} space-y-2`}>
      {items.length ? (
        activeSection === "queue" ? (
          <div className="space-y-1">
            {configGroups.map((group) => (
              <div key={group.category} className="border-t border-slate-100 py-2 first:border-t-0 dark:border-slate-800">
                <div className="px-1 py-3">
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                    {group.title}
                  </h3>
                </div>
                {group.items.map((item) => (
                  <ConfigField
                    key={item.key}
                  item={item}
                  value={drafts[item.key] ?? draftFromItem(item)}
                  secretTouched={Boolean(secretTouched[item.key])}
                  isResetting={resettingKey === item.key}
                  disabled={disabled}
                  workspaceSubpage={workspaceSubpage}
                  onChange={(nextValue, touchedSecret) => onChange(item, nextValue, touchedSecret)}
                  onReset={() => onReset(item)}
                />
                ))}
              </div>
            ))}
          </div>
        ) : activeSection === "upload" ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {items.map((item) => (
              <ConfigField
                key={item.key}
                item={item}
                value={drafts[item.key] ?? draftFromItem(item)}
                secretTouched={Boolean(secretTouched[item.key])}
                isResetting={resettingKey === item.key}
                layout="card"
                disabled={disabled}
                workspaceSubpage={workspaceSubpage}
                onChange={(nextValue, touchedSecret) => onChange(item, nextValue, touchedSecret)}
                onReset={() => onReset(item)}
              />
            ))}
          </div>
        ) : (
          items.map((item) => (
            <ConfigField
              key={item.key}
              item={item}
              value={drafts[item.key] ?? draftFromItem(item)}
              secretTouched={Boolean(secretTouched[item.key])}
              isResetting={resettingKey === item.key}
              disabled={disabled}
              workspaceSubpage={workspaceSubpage}
              onChange={(nextValue, touchedSecret) => onChange(item, nextValue, touchedSecret)}
              onReset={() => onReset(item)}
            />
          ))
        )
      ) : (
        <div className="rounded-lg border border-dashed pf-hairline-strong px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t("settings.section.empty")}
        </div>
      )}
      <div className="flex justify-end gap-3 border-t border-slate-100 pt-5 dark:border-slate-800">
        <button
          type="button"
          onClick={onDiscard}
          disabled={disabled}
          className={SETTINGS_COMPACT_ACTION_CLASS}
        >
          {t("settings.discard")}
        </button>
        <button
          type="submit"
          disabled={disabled || saving}
          className={SETTINGS_MAIN_ACTION_CLASS}
        >
          {saving ? (
            <Loader2 size={14} className="mr-2 animate-spin" />
          ) : (
            <Save size={14} className="mr-2" />
          )}
          {t("settings.save")}
        </button>
      </div>
    </form>
  );
}
