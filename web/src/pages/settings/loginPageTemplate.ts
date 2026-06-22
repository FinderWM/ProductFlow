// 登录页模板配置助手：模板 ID/模式判定、模板 ConfigItem 定位、模板配置草稿的解析与序列化。
// 从 SettingsPage.tsx 抽出，集中登录页模板的纯逻辑与常量。

import type { TranslationKey } from "../../lib/i18n";
import type { ConfigItem, LoginPageMode, LoginPageTemplateId } from "../../lib/types";
import type { DraftValue } from "./types";

export const LOGIN_PAGE_TEMPLATE_IDS: LoginPageTemplateId[] = ["command-orbit", "fluid-mist", "image-lab"];

export const LOGIN_PAGE_TEMPLATE_CONFIG_KEYS: Record<LoginPageTemplateId, string> = {
  "command-orbit": "login_page_command_orbit_config",
  "fluid-mist": "login_page_fluid_mist_config",
  "image-lab": "login_page_image_lab_config",
};

const LOGIN_PAGE_TEMPLATE_ID_BY_CONFIG_KEY = Object.fromEntries(
  Object.entries(LOGIN_PAGE_TEMPLATE_CONFIG_KEYS).map(([templateId, key]) => [key, templateId]),
) as Record<string, LoginPageTemplateId>;

export interface LoginPageTemplateConfigField {
  key: string;
  labelKey: TranslationKey;
  type: "text" | "textarea" | "asset";
}

export const LOGIN_PAGE_TEMPLATE_CONFIG_FIELDS: Record<LoginPageTemplateId, LoginPageTemplateConfigField[]> = {
  "command-orbit": [
    { key: "brand_subtitle", labelKey: "settings.loginPage.commandOrbit.brandSubtitle", type: "text" },
    { key: "hero_title", labelKey: "settings.loginPage.commandOrbit.heroTitle", type: "text" },
    { key: "hero_description", labelKey: "settings.loginPage.commandOrbit.heroDescription", type: "textarea" },
  ],
  "fluid-mist": [
    { key: "greeting_title", labelKey: "settings.loginPage.fluidMist.greetingTitle", type: "text" },
    { key: "greeting_description", labelKey: "settings.loginPage.fluidMist.greetingDescription", type: "text" },
  ],
  "image-lab": [
    { key: "hero_description", labelKey: "settings.loginPage.imageLab.heroDescription", type: "textarea" },
    { key: "hero_image_asset_id", labelKey: "settings.loginPage.imageLab.heroImage", type: "asset" },
  ],
};

export const LOGIN_PAGE_TEMPLATE_LABEL_KEYS: Record<LoginPageTemplateId, TranslationKey> = {
  "command-orbit": "settings.loginPage.template.commandOrbit",
  "fluid-mist": "settings.loginPage.template.fluidMist",
  "image-lab": "settings.loginPage.template.imageLab",
};

export function isLoginPageTemplateId(value: string): value is LoginPageTemplateId {
  return LOGIN_PAGE_TEMPLATE_IDS.includes(value as LoginPageTemplateId);
}

export function isLoginPageMode(value: string): value is LoginPageMode {
  return value === "random" || isLoginPageTemplateId(value);
}

export function loginPageTemplateIdFromConfigKey(key: string): LoginPageTemplateId | null {
  return LOGIN_PAGE_TEMPLATE_ID_BY_CONFIG_KEY[key] ?? null;
}

export function loginPageTemplateConfigItem(
  items: ConfigItem[],
  templateId: LoginPageTemplateId,
): ConfigItem | undefined {
  return items.find((item) => item.key === LOGIN_PAGE_TEMPLATE_CONFIG_KEYS[templateId]);
}

export function parseLoginPageTemplateConfigDraft(
  templateId: LoginPageTemplateId,
  value: DraftValue | ConfigItem["value"],
): Record<string, string> {
  const fieldKeys = LOGIN_PAGE_TEMPLATE_CONFIG_FIELDS[templateId].map((field) => field.key);
  const parsed: Record<string, string> = {};
  for (const fieldKey of fieldKeys) {
    parsed[fieldKey] = "";
  }
  if (typeof value !== "string" || !value.trim()) {
    return parsed;
  }
  try {
    const decoded = JSON.parse(value) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return parsed;
    }
    const decodedRecord = decoded as Record<string, unknown>;
    for (const fieldKey of fieldKeys) {
      const fieldValue = decodedRecord[fieldKey];
      parsed[fieldKey] = fieldValue === null || fieldValue === undefined ? "" : String(fieldValue);
    }
  } catch {
    return parsed;
  }
  return parsed;
}

export function serializeLoginPageTemplateConfigDraft(
  templateId: LoginPageTemplateId,
  config: Record<string, string>,
): string {
  const payload: Record<string, string> = {};
  for (const field of LOGIN_PAGE_TEMPLATE_CONFIG_FIELDS[templateId]) {
    payload[field.key] = config[field.key] ?? "";
  }
  return JSON.stringify(payload);
}
