// 运行时配置项来源标签/样式（database vs 环境默认）。从 SettingsPage.tsx 抽出的纯逻辑。

import type { TranslateFunction } from "../../lib/preferences";
import type { ConfigItem } from "../../lib/types";

export function sourceLabel(item: ConfigItem, t: TranslateFunction): string {
  return item.source === "database" ? t("settings.database") : t("settings.envDefault");
}

export function sourceClassName(item: ConfigItem): string {
  if (item.source === "database") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-slate-700 dark:bg-[#0b1220]";
}
