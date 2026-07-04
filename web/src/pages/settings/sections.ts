// 设置页的区块定义（侧栏分组 + 图标）、区块谓词、运行时配置项的分区与分类分组。
// 从 SettingsPage.tsx 抽出的纯逻辑/配置。

import {
  BellRing,
  CloudSun,
  FileJson,
  Image,
  Layers3,
  LayoutGrid,
  Link2,
  MessageSquareText,
  Palette,
  ServerCog,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";

import type { TranslationKey } from "../../lib/i18n";
import type { ConfigItem, ConfigResponse } from "../../lib/types";

export type SettingsSectionId =
  | "providers"
  | "resourceGroups"
  | "text"
  | "image"
  | "prompts"
  | "upload"
  | "queue"
  | "globalTemplates"
  | "layoutAppearance"
  | "loginPage"
  | "weather"
  | "notifications"
  | "security"
  | "migration";

export interface SettingsSection {
  id: SettingsSectionId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  groupKey: TranslationKey;
  icon: LucideIcon;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "providers",
    labelKey: "settings.section.providers",
    descriptionKey: "settings.section.providersDescription",
    groupKey: "settings.groupProviders",
    icon: ServerCog,
  },
  {
    id: "resourceGroups",
    labelKey: "settings.section.resourceGroups",
    descriptionKey: "settings.section.resourceGroupsDescription",
    groupKey: "settings.groupProviders",
    icon: Link2,
  },
  {
    id: "text",
    labelKey: "settings.section.text",
    descriptionKey: "settings.section.textDescription",
    groupKey: "settings.groupProviders",
    icon: MessageSquareText,
  },
  {
    id: "image",
    labelKey: "settings.section.image",
    descriptionKey: "settings.section.imageDescription",
    groupKey: "settings.groupProviders",
    icon: Image,
  },
  {
    id: "prompts",
    labelKey: "settings.section.prompts",
    descriptionKey: "settings.section.promptsDescription",
    groupKey: "settings.groupWorkflow",
    icon: SlidersHorizontal,
  },
  {
    id: "upload",
    labelKey: "settings.section.upload",
    descriptionKey: "settings.section.uploadDescription",
    groupKey: "settings.groupWorkflow",
    icon: UploadCloud,
  },
  {
    id: "queue",
    labelKey: "settings.section.queue",
    descriptionKey: "settings.section.queueDescription",
    groupKey: "settings.groupWorkflow",
    icon: SettingsIcon,
  },
  {
    id: "globalTemplates",
    labelKey: "settings.section.globalTemplates",
    descriptionKey: "settings.section.globalTemplatesDescription",
    groupKey: "settings.groupWorkflow",
    icon: Layers3,
  },
  {
    id: "layoutAppearance",
    labelKey: "settings.section.layoutAppearance",
    descriptionKey: "settings.section.layoutAppearanceDescription",
    groupKey: "settings.groupExperience",
    icon: Palette,
  },
  {
    id: "loginPage",
    labelKey: "settings.section.loginPage",
    descriptionKey: "settings.section.loginPageDescription",
    groupKey: "settings.groupExperience",
    icon: LayoutGrid,
  },
  {
    id: "weather",
    labelKey: "settings.section.weather",
    descriptionKey: "settings.section.weatherDescription",
    groupKey: "settings.groupExperience",
    icon: CloudSun,
  },
  {
    id: "notifications",
    labelKey: "settings.section.notifications",
    descriptionKey: "settings.section.notificationsDescription",
    groupKey: "settings.groupExperience",
    icon: BellRing,
  },
  {
    id: "security",
    labelKey: "settings.section.security",
    descriptionKey: "settings.section.securityDescription",
    groupKey: "settings.groupSecurity",
    icon: ShieldCheck,
  },
  {
    id: "migration",
    labelKey: "settings.section.migration",
    descriptionKey: "settings.section.migrationDescription",
    groupKey: "settings.groupSecurity",
    icon: FileJson,
  },
];

export const SETTINGS_GROUPS: TranslationKey[] = [
  "settings.groupProviders",
  "settings.groupWorkflow",
  "settings.groupExperience",
  "settings.groupSecurity",
];

export const SETTINGS_DEFAULT_SECTION_ID: SettingsSectionId = "providers";
export const SETTINGS_ROOT_PATH = "/settings";
export const SETTINGS_GLOBAL_TEMPLATES_PATH = "/settings/global-templates";

const SETTINGS_SECTION_PATH_SEGMENTS: Record<SettingsSectionId, string> = {
  providers: "providers",
  resourceGroups: "resource-groups",
  text: "text",
  image: "image",
  prompts: "prompts",
  upload: "upload",
  queue: "queue",
  globalTemplates: "global-templates-hub",
  layoutAppearance: "layout-appearance",
  loginPage: "login-page",
  weather: "weather",
  notifications: "notifications",
  security: "security",
  migration: "migration",
};

const SETTINGS_SECTION_IDS_BY_PATH_SEGMENT = Object.fromEntries(
  Object.entries(SETTINGS_SECTION_PATH_SEGMENTS).map(([sectionId, pathSegment]) => [pathSegment, sectionId]),
) as Record<string, SettingsSectionId>;

const GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX = "全局生成配置 / ";
const LEGACY_GENERATION_QUEUE_CATEGORY = "生成队列";

export function settingsSectionIds(): SettingsSectionId[] {
  return SETTINGS_SECTIONS.map((section) => section.id);
}

export function settingsPathForSection(section: SettingsSectionId): string {
  return `${SETTINGS_ROOT_PATH}/${SETTINGS_SECTION_PATH_SEGMENTS[section]}`;
}

export function settingsSectionFromPathSegment(pathSegment: string | undefined | null): SettingsSectionId | null {
  if (!pathSegment) {
    return null;
  }
  return SETTINGS_SECTION_IDS_BY_PATH_SEGMENT[pathSegment] ?? null;
}

export function isSettingsSectionPathname(pathname: string): boolean {
  if (pathname === SETTINGS_ROOT_PATH) {
    return true;
  }
  if (!pathname.startsWith(`${SETTINGS_ROOT_PATH}/`) || pathname === SETTINGS_GLOBAL_TEMPLATES_PATH) {
    return false;
  }
  return settingsSectionFromPathSegment(pathname.slice(`${SETTINGS_ROOT_PATH}/`.length)) !== null;
}

export function shouldShowSettingsMigrationPanel(section: SettingsSectionId): boolean {
  return section === "migration";
}

export function shouldShowGlobalTemplatesPanel(section: SettingsSectionId): boolean {
  return section === "globalTemplates";
}

export function itemsForSection(config: ConfigResponse | undefined, section: SettingsSectionId): ConfigItem[] {
  const items = config?.items ?? [];
  if (section === "prompts") {
    return items.filter((item) => item.category === "提示词");
  }
  if (section === "upload") {
    return items.filter((item) => item.category === "海报与上传" || item.category === "图片工具参数");
  }
  if (section === "queue") {
    return items.filter(
      (item) =>
        item.category === LEGACY_GENERATION_QUEUE_CATEGORY ||
        item.category.startsWith(GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX),
    );
  }
  if (section === "layoutAppearance") {
    return items.filter((item) => item.category === "界面与外观");
  }
  if (section === "loginPage") {
    return items.filter((item) => item.category === "登录页");
  }
  if (section === "security") {
    return items.filter((item) => item.category === "安全与运维");
  }
  return [];
}

export interface ConfigCategoryGroup {
  category: string;
  title: string;
  items: ConfigItem[];
}

function configCategoryGroupTitle(category: string): string {
  return category.startsWith(GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX)
    ? category.slice(GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX.length)
    : category;
}

export function configCategoryGroups(items: ConfigItem[]): ConfigCategoryGroup[] {
  const groups: ConfigCategoryGroup[] = [];
  for (const item of items) {
    let group = groups.find((candidate) => candidate.category === item.category);
    if (!group) {
      group = {
        category: item.category,
        title: configCategoryGroupTitle(item.category),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
